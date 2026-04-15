const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { initializeDatabase } = require('../../utils/database.js');
const { isAuthenticated } = require('../../middleware/auth.js');
const { getCombinedData } = require('../../utils/content-parser.js');
const config = require('../../config');

const router = express.Router();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        fs.mkdir(config.paths.avatars, { recursive: true })
            .then(() => cb(null, config.paths.avatars))
            .catch(err => cb(err, config.paths.avatars));
    },
    filename: function (req, file, cb) {
        const userId = req.session.user.user_id;
        const fileExtension = path.extname(file.originalname);
        cb(null, `avatar_${userId}_${Date.now()}${fileExtension}`);
    }
});

const upload = multer({ storage: storage });

router.get('/data', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const { user_id } = req.session.user;

    try {
        const user = await db.get('SELECT username, email, created_at, custom_avatar, is_admin FROM users WHERE user_id = ?', user_id);
        const comments = await db.all('SELECT * FROM comments WHERE author_id = ? ORDER BY timestamp DESC', user_id);

        const [likedArticles, bookmarkedArticles, viewedArticles] = await Promise.all([
            db.all('SELECT article_id FROM user_likes WHERE user_id = ?', user_id),
            db.all('SELECT article_id FROM user_bookmarks WHERE user_id = ?', user_id),
            db.all('SELECT article_id FROM user_article_views WHERE user_id = ?', user_id)
        ]);

        const likedArticleIds = likedArticles.map(like => like.article_id);
        const bookmarkedArticleIds = bookmarkedArticles.map(bookmark => bookmark.article_id);
        const viewedArticleIds = viewedArticles.map(view => view.article_id);

        const daysAsMember = Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24));

        let topCategory = 'N/A';
        const interactedArticleIds = [...new Set([...likedArticleIds, ...bookmarkedArticleIds, ...viewedArticleIds])];
        if (interactedArticleIds.length > 0) {
            const { articles } = await getCombinedData();
            const articleMap = new Map(articles.map(a => [a.id, a]));
            const categoryCounts = {};
            interactedArticleIds.forEach(id => {
                const article = articleMap.get(id);
                if (article && article.category) {
                    categoryCounts[article.category] = (categoryCounts[article.category] || 0) + 1;
                }
            });

            if (Object.keys(categoryCounts).length > 0) {
                topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0];
            }
        }

        res.status(200).json({
            user_id: user_id,
            username: user.username,
            email: user.email || null,
            created_at: user.created_at,
            custom_avatar: user.custom_avatar,
            is_admin: user.is_admin,
            stats: {
                comments: comments.length,
                likes: likedArticleIds.length,
                bookmarks: bookmarkedArticleIds.length,
                articlesViewed: viewedArticleIds.length,
                daysAsMember: daysAsMember,
                topCategory: topCategory
            },
            comments: comments.map(comment => ({
                content: comment.content,
                timestamp: comment.timestamp,
                article_id: comment.article_id
            })),
            likedArticleIds,
            bookmarkedArticleIds,
            viewedArticleIds
        });

    } catch (error) {
        console.error('Error fetching account data:', error);
        res.status(500).json({ error: 'Failed to retrieve account data.' });
    }
});

router.post('/avatar', isAuthenticated, upload.single('avatar'), async (req, res) => {
    const db = await initializeDatabase();
    const { user_id } = req.session.user;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        try {
            await fs.access(config.paths.avatars);
        } catch {
            await fs.mkdir(config.paths.avatars, { recursive: true });
        }

        const fileName = `avatar_${user_id}_${Date.now()}.webp`;
        const filePath = path.join(config.paths.avatars, fileName);

        await sharp(req.file.path)
            .resize({ width: 400, height: 400, fit: 'cover' })
            .webp({ quality: 85 })
            .toFile(filePath);

        await fs.unlink(req.file.path);

        const oldUser = await db.get('SELECT custom_avatar FROM users WHERE user_id = ?', user_id);
        if (oldUser && oldUser.custom_avatar) {
            let oldFilePath;
            if (oldUser.custom_avatar.startsWith('uploads/')) {
                oldFilePath = path.join(config.paths.data, oldUser.custom_avatar);
            } else {
                oldFilePath = path.join(config.paths.root, oldUser.custom_avatar);
            }
            try {
                await fs.unlink(oldFilePath);
            } catch (error) {
                console.error('Error deleting old avatar:', error);
            }
        }

        const avatarUrl = `uploads/avatars/${fileName}`;
        await db.run('UPDATE users SET custom_avatar = ? WHERE user_id = ?', avatarUrl, user_id);

        if (req.session.user) {
            req.session.user.custom_avatar = avatarUrl;
        }

        res.status(200).json({ avatarUrl });
    } catch (error) {
        console.error('Error uploading avatar:', error);
        if (req.file && req.file.path) {
            try {
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
                console.error('Error cleaning up file:', cleanupError);
            }
        }
        res.status(500).json({ error: 'An error occurred while uploading the avatar.' });
    }
});

router.delete('/avatar', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const { user_id } = req.session.user;

    try {
        const user = await db.get('SELECT custom_avatar FROM users WHERE user_id = ?', user_id);

        if (user && user.custom_avatar) {
            let filePath;
            if (user.custom_avatar.startsWith('uploads/')) {
                filePath = path.join(config.paths.data, user.custom_avatar);
            } else {
                filePath = path.join(config.paths.root, user.custom_avatar);
            }
            try {
                await fs.unlink(filePath);
            } catch (error) {
                console.error('Error deleting avatar file:', error);
            }
        }

        await db.run('UPDATE users SET custom_avatar = NULL WHERE user_id = ?', user_id);

        if (req.session.user) {
            req.session.user.custom_avatar = null;
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error removing avatar:', error);
        res.status(500).json({ error: 'An error occurred while removing the avatar.' });
    }
});

router.delete('/', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const { user_id } = req.session.user;

    try {
        const user = await db.get('SELECT custom_avatar FROM users WHERE user_id = ?', user_id);
        if (user && user.custom_avatar) {
            let filePath;
            if (user.custom_avatar.startsWith('uploads/')) {
                filePath = path.join(config.paths.data, user.custom_avatar);
            } else {
                filePath = path.join(config.paths.root, user.custom_avatar);
            }
            try {
                await fs.unlink(filePath);
            } catch (error) {
                console.error('Error deleting avatar file:', error);
            }
        }

        await db.run('DELETE FROM users WHERE user_id = ?', user_id);
        req.session.destroy();
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ error: 'An error occurred while deleting your account.' });
    }
});

module.exports = router;
