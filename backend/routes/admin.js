const express = require('express');
const { initializeDatabase } = require('../utils/database.js');
const { isAdmin } = require('../middleware/auth.js');
const { getCombinedData, getSingleArticleById, saveArticleFile, deleteArticleFile, updateArticleStatus, updateArticleFeatured, initializeContent, reloadContent, smartQuotes, smartQuotesMarkdown } = require('../utils/content-parser.js');
const { sendSubscriberEmails } = require('../utils/scheduler.js');
const path = require('path');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const multer = require('multer');
const sharp = require('sharp');
const config = require('../config');

const router = express.Router();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = config.paths.articlesImages;
        fs.mkdir(dir, { recursive: true })
            .then(() => cb(null, dir))
            .catch(err => cb(err, dir));
    },
    filename: function (req, file, cb) {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
        const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
        const ext = path.extname(file.originalname);
        cb(null, `image-${dateStr}-${randomSuffix}${ext}`);
    }
});

const pdfStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = config.paths.issuesPdfs;
        fs.mkdir(dir, { recursive: true })
            .then(() => cb(null, dir))
            .catch(err => cb(err, dir));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
        const baseName = require('path').basename(file.originalname, '.pdf').replace(/[^a-zA-Z0-9-]/g, '');
        cb(null, `${baseName}-${uniqueSuffix}.pdf`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

const uploadPdf = multer({
    storage: pdfStorage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

async function compressArticleImages(req, res, next) {
    const files = req.files;
    if (!files || files.length === 0) return next();

    try {
        for (const file of files) {
            if (!file.mimetype.startsWith('image/')) continue;

            const webpFilename = file.filename.replace(/\.[^.]+$/, '.webp');
            const webpPath = path.join(file.destination, webpFilename);
            const outputPath = path.resolve(file.path) === path.resolve(webpPath)
                ? `${webpPath}.tmp-${Date.now()}`
                : webpPath;

            await sharp(file.path)
                .resize({ width: 1200, withoutEnlargement: true })
                .webp({ quality: 82 })
                .toFile(outputPath);

            await fs.unlink(file.path);
            if (outputPath !== webpPath) {
                await fs.rename(outputPath, webpPath);
            }

            file.filename = webpFilename;
            file.path = webpPath;
            file.mimetype = 'image/webp';
        }
        next();
    } catch (err) {
        console.error('Image compression error:', err);
        next(err);
    }
}

router.post('/cache/refresh', isAdmin, async (req, res) => {
    try {
        await initializeContent();
        res.status(200).json({ message: 'Cache refreshed successfully.' });
    } catch (error) {
        console.error('Error refreshing cache:', error);
        res.status(500).json({ error: 'Failed to refresh cache.' });
    }
});

router.get('/issues', isAdmin, async (req, res) => {
    try {
        const db = await initializeDatabase();
        const issues = await db.all('SELECT * FROM issues ORDER BY date DESC, id DESC');
        res.status(200).json(issues);
    } catch (error) {
        console.error('Error fetching issues:', error);
        res.status(500).json({ error: 'Failed to retrieve issues.' });
    }
});

async function generateIssueCover(pdfPath, coverPath) {
    return new Promise((resolve, reject) => {
        const tmpBase = coverPath.replace(/\.jpg$/, '-tmp');
        execFile('pdftoppm', ['-jpeg', '-r', '150', '-f', '1', '-l', '1', pdfPath, tmpBase], async (err) => {
            if (err) return reject(err);
            const tmpFile = `${tmpBase}-1.jpg`;
            try {
                await fs.rename(tmpFile, coverPath);
                resolve();
            } catch (renameErr) {
                reject(renameErr);
            }
        });
    });
}

router.post('/issues', isAdmin, uploadPdf.single('pdf'), async (req, res) => {
    try {
        const { name, date } = req.body;
        if (!name || !date || !req.file) {
            return res.status(400).json({ error: 'Name, date, and PDF file are required.' });
        }

        const db = await initializeDatabase();
        const result = await db.run(
            'INSERT INTO issues (name, date, filename) VALUES (?, ?, ?)',
            name, date, req.file.filename
        );

        const newIssue = { id: result.lastID, name, date, filename: req.file.filename };

        const pdfPath = req.file.path;
        const baseName = path.basename(req.file.filename, '.pdf');
        const coversDir = config.paths.issuesCovers;
        const coverPath = path.join(coversDir, `${baseName}.jpg`);

        await fs.mkdir(coversDir, { recursive: true });
        generateIssueCover(pdfPath, coverPath).catch(err => {
            console.error('Failed to generate cover image for issue:', err);
        });

        res.status(201).json({ success: true, message: 'Issue added successfully!', issue: newIssue });
    } catch (error) {
        console.error('Error adding issue:', error);
        res.status(500).json({ error: 'Failed to add issue.' });
    }
});

router.delete('/issues/:filename', isAdmin, async (req, res) => {
    try {
        const filename = path.basename(req.params.filename);
        const db = await initializeDatabase();

        const issue = await db.get('SELECT * FROM issues WHERE filename = ?', filename);
        if (!issue) {
            return res.status(404).json({ error: 'Issue not found.' });
        }

        await db.run('DELETE FROM issues WHERE filename = ?', filename);

        const pdfPath = path.join(config.paths.issuesPdfs, filename);
        try {
            await fs.unlink(pdfPath);
        } catch (err) {
            console.warn(`Could not delete PDF file ${filename}:`, err);
        }

        const baseName = path.basename(filename, '.pdf');
        const coverPath = path.join(config.paths.issuesCovers, `${baseName}.jpg`);
        try {
            await fs.unlink(coverPath);
        } catch (err) {
            // Cover may not exist; not a critical error
        }

        res.status(200).json({ success: true, message: 'Issue deleted successfully.' });
    } catch (error) {
        console.error('Error deleting issue:', error);
        res.status(500).json({ error: 'Failed to delete issue.' });
    }
});

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.statusCode = 400;
    }
}

// Helper to consolidate form fields into an article object
function processArticleFormData(req) {
    const { title } = req.body;
    const date = req.body.date || req.body.date_nonscheduled || '';

    if (!title) {
        throw new ValidationError("Article title is required.");
    }

    const normalizeArray = (val) => {
        if (!val) return [];
        return Array.isArray(val) ? val : [val];
    };

    const authors = [];
    const authorNames = normalizeArray(req.body.author_names);
    const authorRoles = normalizeArray(req.body.author_roles);

    authorNames.forEach((name, i) => {
        if (name && name.trim()) {
            authors.push({
                name: smartQuotes(name.trim()),
                role: smartQuotes(authorRoles[i] || 'Contributor')
            });
        }
    });

    let formattedDate;
    try {
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
             formattedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase();
        } else {
             formattedDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase();
        }
    } catch (e) {
        formattedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase();
    }

    const imagePlacements = normalizeArray(req.body.image_placements);
    const imageUrls = normalizeArray(req.body.image_urls);
    const imageCaptions = normalizeArray(req.body.image_captions);
    const imageCredits = normalizeArray(req.body.image_credits);
    const imageAlts = normalizeArray(req.body.image_alts);
    const reqFiles = req.files || [];

    const images = [];

    imagePlacements.forEach((placement, index) => {
        let fileStr = '';

        const uploadedFile = reqFiles.find(f => f.fieldname === `image_${index}`);

        if (uploadedFile) {
            fileStr = `data/articles/images/${uploadedFile.filename}`;
        } else if (imageUrls && imageUrls[index] && imageUrls[index].trim() !== '') {
            fileStr = imageUrls[index];
        }

        if (fileStr) {
            images.push({
                file: fileStr,
                placement: placement,
                caption: imageCaptions[index] || '',
                credit: imageCredits[index] || '',
                alt: imageAlts[index] || ''
            });
        }
    });

    // Article flags
    const featured = req.body.flag_featured === 'true';
    const breaking = req.body.flag_breaking === 'true';
    const pinned   = req.body.flag_pinned === 'true';
    const commentsDisabled = req.body.comments_disabled === 'true';

    // Build scheduledAt from date + time if status is Scheduled
    let scheduledAt = null;
    if (req.body.status === 'Scheduled') {
        const dateVal = req.body.date;
        const timeVal = req.body.publish_time || '00:00';
        if (dateVal) {
            const parsed = new Date(`${dateVal}T${timeVal}:00`);
            if (!isNaN(parsed.getTime())) {
                scheduledAt = parsed.toISOString();
            }
        }
    }

    const sqImages = images.map(img => ({
        ...img,
        caption: smartQuotes(img.caption),
        credit: smartQuotes(img.credit)
    }));

    const embedPlacements = normalizeArray(req.body.embed_placements);
    const embedCodes = normalizeArray(req.body.embed_codes);
    const embedWidths = normalizeArray(req.body.embed_widths);
    const embedHeights = normalizeArray(req.body.embed_heights);

    const embeds = embedPlacements.map((placement, index) => {
        const code = (embedCodes[index] || '').trim();
        if (!code) return null;
        return {
            code,
            placement,
            width: embedWidths[index] || '100%',
            height: embedHeights[index] || '560'
        };
    }).filter(Boolean);

    return {
        title: smartQuotes(title),
        date: formattedDate,
        category: req.body.category,
        tags: smartQuotes(req.body.tags || ''),
        description: smartQuotes(req.body.description || ''),
        content: smartQuotesMarkdown(req.body.content),
        status: req.body.status || 'Published',
        authors,
        images: sqImages,
        embeds,
        slug: req.body.slug ? req.body.slug.trim() : null,
        seoTitle: req.body.seo_title ? smartQuotes(req.body.seo_title.trim()) : null,
        seoDescription: req.body.seo_description ? smartQuotes(req.body.seo_description.trim()) : null,
        featured,
        breaking,
        pinned,
        commentsDisabled,
        scheduledAt
    };
}

async function updateArticleCommentSettings(articleId, commentsDisabled) {
    const db = await initializeDatabase();
    await db.run(
        `INSERT INTO articles (article_id, likes, comments_disabled)
         VALUES (?, 0, ?)
         ON CONFLICT(article_id) DO UPDATE SET comments_disabled = excluded.comments_disabled`,
        articleId,
        commentsDisabled ? 1 : 0
    );
}

router.post('/articles', isAdmin, upload.any(), compressArticleImages, async (req, res) => {
    try {
        const articleData = processArticleFormData(req);

        const articleId = await saveArticleFile(articleData);
        await updateArticleCommentSettings(articleId, articleData.commentsDisabled);

        res.status(201).json({ success: true, message: 'Article published successfully!', articleId: articleId });

        if (articleData.status === 'Published') {
            sendSubscriberEmails([{
                articleId,
                title: articleData.title,
                description: articleData.description || '',
                category: articleData.category || '',
            }]).catch(err => console.error('[Admin] Failed to send subscriber emails:', err.message));
        }
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Error creating article:', error);
        res.status(500).json({ error: 'Failed to create article: ' + error.message });
    }
});

router.put('/articles/:id', isAdmin, upload.any(), compressArticleImages, async (req, res) => {
    try {
        const articleId = req.params.id;
        const articleData = processArticleFormData(req);

        // Check the previous status so we only notify subscribers when
        // an article transitions INTO Published (not on every subsequent edit).
        let previousStatus = null;
        try {
            const db = await initializeDatabase();
            const row = await db.get('SELECT content FROM article_files WHERE article_id = ?', articleId);
            if (row) {
                const match = row.content.match(/^Status:\s*(.+)$/mi);
                previousStatus = match ? match[1].trim() : 'Published';
            }
        } catch (_) {}

        await saveArticleFile(articleData, articleId);
        await updateArticleCommentSettings(articleId, articleData.commentsDisabled);

        res.status(200).json({ success: true, message: 'Article updated successfully!', articleId: articleId });

        const isNowPublished = articleData.status === 'Published';
        const wasAlreadyPublished = previousStatus === 'Published';
        if (isNowPublished && !wasAlreadyPublished) {
            sendSubscriberEmails([{
                articleId,
                title: articleData.title,
                description: articleData.description || '',
                category: articleData.category || '',
            }]).catch(err => console.error('[Admin] Failed to send subscriber emails:', err.message));
        }
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'Article not found to update.' });
        }
        console.error('Error updating article:', error);
        res.status(500).json({ error: 'Failed to update article: ' + error.message });
    }
});

router.delete('/articles/:id', isAdmin, async (req, res) => {
    try {
        const articleId = req.params.id;

        // Use Content Manager to delete file
        await deleteArticleFile(articleId);

        const db = await initializeDatabase();
        await db.run('DELETE FROM articles WHERE article_id = ?', articleId);

        res.status(200).json({ success: true, message: 'Article deleted.' });
    } catch (error) {
        console.error('Error deleting article:', error);
        res.status(500).json({ error: 'Failed to delete article.' });
    }
});

router.patch('/articles/:id/status', isAdmin, async (req, res) => {
    try {
        const articleId = req.params.id;
        const { status } = req.body;

        // Use Content Manager to toggle status
        const newStatus = await updateArticleStatus(articleId, status);

        res.status(200).json({ success: true, newStatus: newStatus });
    } catch (error) {
        console.error('Error toggling status:', error);
        res.status(500).json({ error: 'Failed to update status.' });
    }
});

router.patch('/articles/:id/featured', isAdmin, async (req, res) => {
    try {
        const articleId = req.params.id;
        const { featured } = req.body;

        if (typeof featured !== 'boolean') {
            return res.status(400).json({ error: 'featured must be a boolean.' });
        }

        await updateArticleFeatured(articleId, featured);
        res.status(200).json({ success: true, featured });
    } catch (error) {
        console.error('Error updating featured status:', error);
        res.status(500).json({ error: 'Failed to update featured status.' });
    }
});

router.get('/articles', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    try {
        const { articles } = await getCombinedData(true);

        // Fetch all stats in 3 aggregate queries instead of 3×N per-article queries.
        const [allLikes, allComments, allViews] = await Promise.all([
            db.all('SELECT article_id, likes, comments_disabled FROM articles'),
            db.all('SELECT article_id, COUNT(*) AS count FROM comments GROUP BY article_id'),
            db.all('SELECT article_id, COUNT(*) AS count FROM user_article_views GROUP BY article_id')
        ]);

        const likesMap = new Map(allLikes.map(r => [r.article_id, r.likes]));
        const commentsDisabledMap = new Map(allLikes.map(r => [r.article_id, !!r.comments_disabled]));
        const commentsMap = new Map(allComments.map(r => [r.article_id, r.count]));
        const viewsMap = new Map(allViews.map(r => [r.article_id, r.count]));

        const articlesWithStats = articles.map(article => ({
            id: article.id,
            title: article.title,
            likes: likesMap.get(article.id) || 0,
            comments: commentsMap.get(article.id) || 0,
            views: viewsMap.get(article.id) || 0,
            date: article.date,
            category: article.category,
            status: article.status || 'Published',
            featured: article.featured || false,
            comments_disabled: commentsDisabledMap.get(article.id) || false
        }));

        res.status(200).json(articlesWithStats);
    } catch (error) {
        console.error('Error fetching article analytics:', error);
        res.status(500).json({ error: 'Failed to retrieve article analytics.' });
    }
});

router.get('/articles/:id', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    try {
        const article = await getSingleArticleById(req.params.id, true);

        if (!article) {
            return res.status(404).json({ error: 'Article not found.' });
        }

        let dynamicData = await db.get('SELECT likes, comments_disabled FROM articles WHERE article_id = ?', article.id);
        if (!dynamicData) {
            dynamicData = { likes: 0, comments_disabled: 0 };
        }

        const fullArticle = { ...article, likes: dynamicData.likes, comments_disabled: !!dynamicData.comments_disabled };

        if (req.session.user) {
            const [hasLiked, hasBookmarked] = await Promise.all([
                db.get('SELECT 1 FROM user_likes WHERE user_id = ? AND article_id = ?', req.session.user.user_id, article.id),
                db.get('SELECT 1 FROM user_bookmarks WHERE user_id = ? AND article_id = ?', req.session.user.user_id, article.id)
            ]);

            fullArticle.user_has_liked = !!hasLiked;
            fullArticle.user_has_bookmarked = !!hasBookmarked;
        }

        res.status(200).json(fullArticle);
    } catch (error) {
        console.error('Error fetching full admin article:', error);
        res.status(500).json({ error: 'Failed to fetch article.' });
    }
});

router.get('/stats', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    try {
        const { articles } = await getCombinedData(true);

        const [totalUsers, totalComments, totalLikes, totalViews] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM comments'),
            db.get('SELECT SUM(likes) as total FROM articles'),
            db.get('SELECT COUNT(*) as count FROM user_article_views')
        ]);

        res.status(200).json({
            totalUsers: totalUsers.count || 0,
            totalComments: totalComments.count || 0,
            totalArticles: articles.length || 0,
            totalLikes: totalLikes.total || 0,
            totalViews: totalViews.count || 0
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Failed to retrieve statistics.' });
    }
});

router.get('/dashboard', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    try {
        const { articles, staff } = await getCombinedData(true);

        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const articleMap = new Map(articles.map(a => [a.id, a.title]));

        const [
            totalUsers,
            recentUsers,
            totalComments,
            recentComments,
            totalLikes,
            totalViews,
            recentViews
        ] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM users WHERE created_at > ?', sevenDaysAgo.toISOString()),
            db.get('SELECT COUNT(*) as count FROM comments'),
            db.get('SELECT COUNT(*) as count FROM comments WHERE timestamp > ?', sevenDaysAgo.toISOString()),
            db.get('SELECT SUM(likes) as total FROM articles'),
            db.get('SELECT COUNT(*) as count FROM user_article_views'),
            db.get('SELECT COUNT(*) as count FROM user_article_views WHERE timestamp > ?', sevenDaysAgo.toISOString())
        ]);

        const topCommentersRaw = await db.all(`
            SELECT c.author_name, c.author_id, u.custom_avatar, COUNT(*) as count
            FROM comments c
            LEFT JOIN users u ON c.author_id = u.user_id
            WHERE c.timestamp > ?
            GROUP BY c.author_id
            ORDER BY count DESC
            LIMIT 5
        `, thirtyDaysAgo.toISOString());

        const topCommenters = topCommentersRaw.map(r => ({ 
            label: r.author_name, 
            value: r.count,
            id: r.author_id,
            avatar: r.custom_avatar 
        }));

        const authorStats = {};

        articles.forEach(article => {
            if (article.writers) {
                article.writers.forEach(writer => {
                    const name = writer.name.trim();
                    if (name.toUpperCase() !== 'ANDOVERVIEW') {
                        if (!authorStats[name]) {
                            authorStats[name] = { 
                                count: 0, 
                                image: writer.image 
                            };
                        }
                        authorStats[name].count++;
                    }
                });
            }
        });

        const topAuthors = Object.entries(authorStats)
            .map(([name, stats]) => ({ 
                label: name, 
                value: stats.count,
                avatar: stats.image 
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);

        const topViewsRaw = await db.all(`
            SELECT article_id, COUNT(*) as count 
            FROM user_article_views 
            GROUP BY article_id 
            ORDER BY count DESC 
            LIMIT 5
        `);
        const topViewed = topViewsRaw.map(r => ({ 
            label: articleMap.get(r.article_id) || r.article_id, 
            value: r.count 
        })).filter(r => r.label && r.value > 0);

        const topLikesRaw = await db.all(`
            SELECT article_id, likes 
            FROM articles 
            ORDER BY likes DESC 
            LIMIT 5
        `);
        const topLiked = topLikesRaw.map(r => ({ 
            label: articleMap.get(r.article_id) || r.article_id, 
            value: r.likes 
        })).filter(r => r.label && r.value > 0);

        const topCommentedRaw = await db.all(`
            SELECT article_id, COUNT(*) as count
            FROM comments
            GROUP BY article_id
            ORDER BY count DESC
            LIMIT 5
        `);
        const topCommented = topCommentedRaw.map(r => ({
            label: articleMap.get(r.article_id) || r.article_id,
            value: r.count
        })).filter(r => r.label && r.value > 0);

        res.status(200).json({
            overview: {
                totalUsers: totalUsers.count || 0,
                newUsersThisWeek: recentUsers.count || 0,
                totalComments: totalComments.count || 0,
                newCommentsThisWeek: recentComments.count || 0,
                totalArticles: articles.length || 0,
                totalLikes: totalLikes.total || 0,
                totalViews: totalViews.count || 0,
                newViewsThisWeek: recentViews.count || 0
            },
            charts: {
                commenters: topCommenters,
                authors: topAuthors,
                views: topViewed,
                likes: topLiked,
                commented: topCommented
            },
            recentActivity: {
                commentsGrowth: recentComments.count || 0,
                viewsGrowth: recentViews.count || 0,
                usersGrowth: recentUsers.count || 0
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({ error: 'Failed to retrieve dashboard data.' });
    }
});

router.get('/contacts', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    try {
        const contacts = await db.all('SELECT * FROM contacts ORDER BY submitted_at DESC');
        res.status(200).json(contacts);
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: 'Failed to retrieve contact submissions.' });
    }
});

router.delete('/contacts/:id', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    const contactId = parseInt(req.params.id);
    try {
        const contact = await db.get('SELECT contact_id FROM contacts WHERE contact_id = ?', contactId);
        if (!contact) {
            return res.status(404).json({ error: 'Contact submission not found.' });
        }
        await db.run('DELETE FROM contacts WHERE contact_id = ?', contactId);
        res.status(200).json({ success: true, message: 'Contact submission deleted.' });
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({ error: 'Failed to delete contact submission.' });
    }
});

router.get('/users', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    try {
        const users = await db.all(`
            SELECT 
                u.user_id,
                u.username,
                u.created_at,
                u.is_admin,
                COUNT(c.comment_id) as comment_count
            FROM users u
            LEFT JOIN comments c ON u.user_id = c.author_id
            GROUP BY u.user_id
            ORDER BY u.created_at DESC
        `);

        res.status(200).json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to retrieve users.' });
    }
});

router.delete('/users/:userId', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    const userId = parseInt(req.params.userId);
    const adminUserId = req.session.user.user_id;

    if (userId === adminUserId) {
        return res.status(400).json({ error: 'You cannot delete your own account from the admin panel.' });
    }

    try {
        const user = await db.get('SELECT user_id, custom_avatar FROM users WHERE user_id = ?', userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        if (user.custom_avatar) {
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

        await db.run('DELETE FROM users WHERE user_id = ?', userId);
        res.status(200).json({ message: 'User deleted successfully.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'An error occurred while deleting the user.' });
    }
});

router.get('/comments/recent', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    const limit = parseInt(req.query.limit) || 50;

    try {
        let query = `
            SELECT
                c.comment_id,
                c.article_id,
                c.author_id,
                c.author_name,
                c.content,
                c.timestamp,
                c.edited_at,
                u.custom_avatar,
                u.is_admin as author_is_admin
            FROM comments c
            LEFT JOIN users u ON c.author_id = u.user_id
            ORDER BY c.timestamp DESC
        `;

        const params = [];
        if (limit !== -1) {
            query += ` LIMIT ?`;
            params.push(limit);
        }

        const comments = await db.all(query, ...params);

        res.status(200).json(comments);
    } catch (error) {
        console.error('Error fetching recent comments:', error);
        res.status(500).json({ error: 'Failed to retrieve recent comments.' });
    }
});

router.put('/comments/:commentId', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    const commentId = req.params.commentId;
    const { content } = req.body;

    if (!content) {
        return res.status(400).json({ error: 'Comment content is required.' });
    }

    try {
        const comment = await db.get('SELECT * FROM comments WHERE comment_id = ?', commentId);
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found.' });
        }

        await db.run('UPDATE comments SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE comment_id = ?', content, commentId);
        const updatedComment = await db.get(`
            SELECT
                c.comment_id, c.article_id, c.author_id, c.author_name, c.content, c.timestamp, c.edited_at,
                u.custom_avatar, u.is_admin as author_is_admin
            FROM comments c
            LEFT JOIN users u ON c.author_id = u.user_id
            WHERE c.comment_id = ?
        `, commentId);
        res.status(200).json(updatedComment);
    } catch (error) {
        console.error('Error editing comment:', error);
        res.status(500).json({ error: 'An error occurred while editing the comment.' });
    }
});

router.delete('/comments/:commentId', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    const commentId = req.params.commentId;

    try {
        const comment = await db.get('SELECT * FROM comments WHERE comment_id = ?', commentId);
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found.' });
        }

        await db.run('DELETE FROM comments WHERE comment_id = ?', commentId);
        res.status(200).json({ message: 'Comment deleted successfully.' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'An error occurred while deleting the comment.' });
    }
});

router.get('/users/:userId', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    const userId = parseInt(req.params.userId);

    try {
        const user = await db.get(`
            SELECT 
                user_id,
                username,
                created_at,
                is_admin,
                custom_avatar
            FROM users
            WHERE user_id = ?
        `, userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const [commentCount, likeCount, bookmarkCount, viewCount] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM comments WHERE author_id = ?', userId),
            db.get('SELECT COUNT(*) as count FROM user_likes WHERE user_id = ?', userId),
            db.get('SELECT COUNT(*) as count FROM user_bookmarks WHERE user_id = ?', userId),
            db.get('SELECT COUNT(*) as count FROM user_article_views WHERE user_id = ?', userId)
        ]);

        res.status(200).json({
            ...user,
            stats: {
                comments: commentCount.count || 0,
                likes: likeCount.count || 0,
                bookmarks: bookmarkCount.count || 0,
                views: viewCount.count || 0
            }
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Failed to retrieve user profile.' });
    }
});

router.get('/users/:userId/activity', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    const userId = parseInt(req.params.userId);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const [comments, likedArticles, bookmarkedArticles] = await Promise.all([
            db.all(`
                SELECT
                    c.comment_id,
                    c.article_id,
                    c.content,
                    c.timestamp,
                    c.edited_at
                FROM comments c
                WHERE c.author_id = ?
                ORDER BY c.timestamp DESC
                LIMIT ? OFFSET ?
            `, userId, limit, offset),
            db.all(`
                SELECT article_id, timestamp as liked_at
                FROM user_likes
                WHERE user_id = ?
                ORDER BY timestamp DESC
                LIMIT 20
            `, userId),
            db.all(`
                SELECT article_id, timestamp as bookmarked_at
                FROM user_bookmarks
                WHERE user_id = ?
                ORDER BY timestamp DESC
                LIMIT 20
            `, userId)
        ]);

        res.status(200).json({
            comments,
            likedArticles: likedArticles.map(l => l.article_id),
            bookmarkedArticles: bookmarkedArticles.map(b => b.article_id)
        });
    } catch (error) {
        console.error('Error fetching user activity:', error);
        res.status(500).json({ error: 'Failed to retrieve user activity.' });
    }
});

router.get('/search', isAdmin, async (req, res) => {
    const db = await initializeDatabase();
    const query = req.query.q?.toLowerCase() || '';

    if (!query || query.length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
    }

    try {
        const { articles } = await getCombinedData();

        const [users, comments] = await Promise.all([
            db.all(`
                SELECT user_id, username, created_at, is_admin
                FROM users
                WHERE LOWER(username) LIKE ?
                LIMIT 10
            `, `%${query}%`),
            db.all(`
                SELECT
                    c.comment_id,
                    c.article_id,
                    c.author_id,
                    c.author_name,
                    c.content,
                    c.timestamp
                FROM comments c
                WHERE LOWER(c.content) LIKE ? OR LOWER(c.author_name) LIKE ?
                ORDER BY c.timestamp DESC
                LIMIT 20
            `, `%${query}%`, `%${query}%`)
        ]);

        const matchedArticles = articles.filter(a =>
            a.title.toLowerCase().includes(query) ||
            a.id.toLowerCase().includes(query)
        ).slice(0, 10).map(a => ({ id: a.id, title: a.title, category: a.category }));

        res.status(200).json({
            users,
            articles: matchedArticles,
            comments
        });
    } catch (error) {
        console.error('Error performing admin search:', error);
        res.status(500).json({ error: 'Search failed.' });
    }
});

// ─── Staff Management ──────────────────────────────────────────────────────────

const staffImageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = config.paths.staffUploads;
        fs.mkdir(dir, { recursive: true })
            .then(() => cb(null, dir))
            .catch(err => cb(err, dir));
    },
    filename: function (req, file, cb) {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
        const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
        const ext = path.extname(file.originalname);
        cb(null, `staff-img-${dateStr}-${randomSuffix}${ext}`);
    }
});

const uploadStaffImage = multer({
    storage: staffImageStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    }
});

async function compressStaffImage(file) {
    const webpFilename = file.filename.replace(/\.[^.]+$/, '.webp');
    const webpPath = path.join(file.destination, webpFilename);
    const outputPath = path.resolve(file.path) === path.resolve(webpPath)
        ? `${webpPath}.tmp-${Date.now()}`
        : webpPath;
    await sharp(file.path)
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(outputPath);
    await fs.unlink(file.path);
    if (outputPath !== webpPath) {
        await fs.rename(outputPath, webpPath);
    }
    return { filename: webpFilename, path: webpPath };
}

async function deleteStaffImageFile(imagePath) {
    if (!imagePath || !imagePath.startsWith('uploads/staff/')) return;
    try {
        const filename = path.basename(imagePath);
        await fs.unlink(path.join(config.paths.staffUploads, filename));
    } catch (_) {}
}

router.get('/staff', isAdmin, async (req, res) => {
    try {
        const db = await initializeDatabase();
        const staff = await db.all('SELECT id, name, role, image, bio, sort_order FROM staff ORDER BY sort_order, id');
        res.json(staff);
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ error: 'Failed to fetch staff.' });
    }
});

router.post('/staff', isAdmin, uploadStaffImage.single('image'), async (req, res) => {
    try {
        const { name, role, imageUrl, bio } = req.body;
        if (!name || !role) {
            return res.status(400).json({ error: 'Name and role are required.' });
        }

        let image = imageUrl || '';

        if (req.file) {
            const compressed = await compressStaffImage(req.file);
            image = `uploads/staff/${compressed.filename}`;
        }

        const db = await initializeDatabase();
        const maxOrder = await db.get('SELECT MAX(sort_order) as max FROM staff');
        const sortOrder = (maxOrder.max ?? -1) + 1;

        await db.run(
            'INSERT INTO staff (name, role, image, bio, sort_order) VALUES (?, ?, ?, ?, ?)',
            name.trim(), smartQuotes(role.trim()), image, smartQuotes((bio || '').trim()), sortOrder
        );

        await reloadContent();
        res.status(201).json({ success: true, message: 'Staff member added.' });
    } catch (error) {
        console.error('Error adding staff member:', error);
        res.status(500).json({ error: 'Failed to add staff member.' });
    }
});

router.put('/staff/order', isAdmin, async (req, res) => {
    try {
        const { staffIds } = req.body;
        if (!Array.isArray(staffIds) || staffIds.length === 0) {
            return res.status(400).json({ error: 'staffIds must be a non-empty array.' });
        }

        const normalizedIds = staffIds.map(id => parseInt(id, 10));
        if (normalizedIds.some(id => !Number.isInteger(id))) {
            return res.status(400).json({ error: 'All staff IDs must be valid numbers.' });
        }

        const uniqueIds = new Set(normalizedIds);
        if (uniqueIds.size !== normalizedIds.length) {
            return res.status(400).json({ error: 'Staff IDs must not contain duplicates.' });
        }

        const db = await initializeDatabase();
        const existingRows = await db.all('SELECT id FROM staff');
        const existingIds = new Set(existingRows.map(row => row.id));
        if (existingIds.size !== normalizedIds.length || normalizedIds.some(id => !existingIds.has(id))) {
            return res.status(400).json({ error: 'Staff order must include every current staff member exactly once.' });
        }

        await db.run('BEGIN TRANSACTION');
        try {
            for (let index = 0; index < normalizedIds.length; index++) {
                await db.run('UPDATE staff SET sort_order = ? WHERE id = ?', index, normalizedIds[index]);
            }
            await db.run('COMMIT');
        } catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }

        await reloadContent();
        res.json({ success: true, message: 'Staff order updated.' });
    } catch (error) {
        console.error('Error updating staff order:', error);
        res.status(500).json({ error: 'Failed to update staff order.' });
    }
});

router.put('/staff/:id', isAdmin, uploadStaffImage.single('image'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { name, role, imageUrl, bio, clearImage } = req.body;

        if (!name || !role) {
            return res.status(400).json({ error: 'Name and role are required.' });
        }

        const db = await initializeDatabase();
        const existing = await db.get('SELECT * FROM staff WHERE id = ?', id);
        if (!existing) {
            return res.status(404).json({ error: 'Staff member not found.' });
        }

        let image = existing.image;

        if (clearImage === 'true') {
            await deleteStaffImageFile(image);
            image = '';
        } else if (imageUrl !== undefined && imageUrl !== '') {
            image = imageUrl.trim();
        }

        if (req.file) {
            await deleteStaffImageFile(image);
            const compressed = await compressStaffImage(req.file);
            image = `uploads/staff/${compressed.filename}`;
        }

        await db.run(
            'UPDATE staff SET name = ?, role = ?, image = ?, bio = ? WHERE id = ?',
            name.trim(), smartQuotes(role.trim()), image, smartQuotes((bio || '').trim()), id
        );

        await reloadContent();
        res.json({ success: true, message: 'Staff member updated.' });
    } catch (error) {
        console.error('Error updating staff member:', error);
        res.status(500).json({ error: 'Failed to update staff member.' });
    }
});

router.delete('/staff/:id', isAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const db = await initializeDatabase();

        const existing = await db.get('SELECT * FROM staff WHERE id = ?', id);
        if (!existing) {
            return res.status(404).json({ error: 'Staff member not found.' });
        }

        await deleteStaffImageFile(existing.image);
        await db.run('DELETE FROM staff WHERE id = ?', id);

        await reloadContent();
        res.json({ success: true, message: 'Staff member deleted.' });
    } catch (error) {
        console.error('Error deleting staff member:', error);
        res.status(500).json({ error: 'Failed to delete staff member.' });
    }
});

router.post('/migrate-smart-quotes', isAdmin, async (req, res) => {
    try {
        const db = await initializeDatabase();
        const rows = await db.all('SELECT article_id, content FROM article_files');
        const TEXT_FRONTMATTER_KEYS = new Set(['title', 'description', 'seotitle', 'seodescription']);
        let updated = 0;

        for (const row of rows) {
            const lines = row.content.split('\n');

            let bodyStart = -1;
            for (let i = 0; i < lines.length; i++) {
                if (i > 0 && lines[i].trim() === '') { bodyStart = i; break; }
            }

            const headerLines = bodyStart === -1 ? lines : lines.slice(0, bodyStart);
            const bodyLines  = bodyStart === -1 ? []    : lines.slice(bodyStart);

            const newHeaderLines = headerLines.map(line => {
                const colonIdx = line.indexOf(':');
                if (colonIdx <= 0) return line;
                const key = line.substring(0, colonIdx).trim().toLowerCase();
                const val = line.substring(colonIdx + 1);
                const isText = TEXT_FRONTMATTER_KEYS.has(key)
                    || /^imagecaption\s/i.test(key)
                    || /^imagecredit\s/i.test(key);
                return isText ? line.substring(0, colonIdx + 1) + smartQuotes(val) : line;
            });

            const newBody = bodyLines.length > 0 ? smartQuotesMarkdown(bodyLines.join('\n')) : '';
            const newContent = newHeaderLines.join('\n') + (newBody ? '\n' + newBody : '');

            if (newContent !== row.content) {
                await db.run(
                    'UPDATE article_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE article_id = ?',
                    newContent, row.article_id
                );
                updated++;
            }
        }

        await reloadContent();
        res.json({ success: true, total: rows.length, updated, message: `Normalized smart quotes in ${updated} of ${rows.length} articles.` });
    } catch (err) {
        console.error('Smart quote migration error:', err);
        res.status(500).json({ error: 'Migration failed.' });
    }
});

// ─── Article Drafts ──────────────────────────────────────────────────────────

router.get('/drafts/:key', isAdmin, async (req, res) => {
    try {
        const db = await initializeDatabase();
        const row = await db.get('SELECT data, saved_at FROM article_drafts WHERE draft_key = ?', req.params.key);
        if (!row) return res.status(404).json({ draft: null });
        res.json({ draft: JSON.parse(row.data), savedAt: row.saved_at });
    } catch (err) {
        console.error('Error fetching draft:', err);
        res.status(500).json({ error: 'Failed to fetch draft.' });
    }
});

router.put('/drafts/:key', isAdmin, async (req, res) => {
    try {
        const db = await initializeDatabase();
        const data = JSON.stringify(req.body);
        await db.run(
            'INSERT INTO article_drafts (draft_key, data, saved_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(draft_key) DO UPDATE SET data = excluded.data, saved_at = CURRENT_TIMESTAMP',
            req.params.key, data
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving draft:', err);
        res.status(500).json({ error: 'Failed to save draft.' });
    }
});

router.delete('/drafts/:key', isAdmin, async (req, res) => {
    try {
        const db = await initializeDatabase();
        await db.run('DELETE FROM article_drafts WHERE draft_key = ?', req.params.key);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting draft:', err);
        res.status(500).json({ error: 'Failed to delete draft.' });
    }
});

module.exports = router;