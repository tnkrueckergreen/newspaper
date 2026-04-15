const express = require('express');
const { initializeDatabase } = require('../../utils/database.js');
const { isAuthenticated } = require('../../middleware/auth.js');

const router = express.Router();

router.post('/:id/like', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const articleId = req.params.id;
    const { action } = req.body;
    const { user_id } = req.session.user;

    try {
        // SAFETY: Ensure article row exists before modification
        await db.run('INSERT OR IGNORE INTO articles (article_id, likes) VALUES (?, 0)', articleId);

        const existingLike = await db.get('SELECT * FROM user_likes WHERE user_id = ? AND article_id = ?', user_id, articleId);

        if (action === 'like' && !existingLike) {
            await db.run('INSERT INTO user_likes (user_id, article_id) VALUES (?, ?)', user_id, articleId);
            await db.run('UPDATE articles SET likes = likes + 1 WHERE article_id = ?', articleId);
        } else if (action === 'unlike' && existingLike) {
            await db.run('DELETE FROM user_likes WHERE user_id = ? AND article_id = ?', user_id, articleId);
            await db.run('UPDATE articles SET likes = MAX(0, likes - 1) WHERE article_id = ?', articleId);
        }

        const result = await db.get('SELECT likes FROM articles WHERE article_id = ?', articleId);
        const userHasLiked = !!(await db.get('SELECT 1 FROM user_likes WHERE user_id = ? AND article_id = ?', user_id, articleId));

        res.status(200).json({ likes: result ? result.likes : 0, user_has_liked: userHasLiked });
    } catch (error) {
        console.error('Error processing like:', error);
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

router.post('/:id/bookmark', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const articleId = req.params.id;
    const { action } = req.body;
    const { user_id } = req.session.user;

    try {
        // SAFETY: Ensure article row exists before modification (FK constraint on bookmarks)
        await db.run('INSERT OR IGNORE INTO articles (article_id, likes) VALUES (?, 0)', articleId);

        const existingBookmark = await db.get('SELECT * FROM user_bookmarks WHERE user_id = ? AND article_id = ?', user_id, articleId);

        if (action === 'bookmark' && !existingBookmark) {
            await db.run('INSERT INTO user_bookmarks (user_id, article_id) VALUES (?, ?)', user_id, articleId);
        } else if (action === 'unbookmark' && existingBookmark) {
            await db.run('DELETE FROM user_bookmarks WHERE user_id = ? AND article_id = ?', user_id, articleId);
        }

        const userHasBookmarked = !!(await db.get('SELECT 1 FROM user_bookmarks WHERE user_id = ? AND article_id = ?', user_id, articleId));

        res.status(200).json({ user_has_bookmarked: userHasBookmarked, bookmarked: userHasBookmarked });
    } catch (error) {
        console.error('Error processing bookmark:', error);
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

module.exports = router;