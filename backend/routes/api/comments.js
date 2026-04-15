const express = require('express');
const { initializeDatabase } = require('../../utils/database.js');
const { isAuthenticated } = require('../../middleware/auth.js');
const { commentLimiter } = require('../../middleware/rateLimiter.js');

const articleCommentsRouter = express.Router();
const commentRouter = express.Router();

articleCommentsRouter.get('/:id/comments', async (req, res) => {
    const db = await initializeDatabase();
    const articleId = req.params.id;
    const comments = await db.all(`
        SELECT
            c.comment_id, c.article_id, c.author_id, c.author_name, c.content, c.timestamp, c.edited_at,
            u.custom_avatar, u.is_admin as author_is_admin
        FROM comments c
        LEFT JOIN users u ON c.author_id = u.user_id
        WHERE c.article_id = ?
        ORDER BY c.timestamp DESC
    `, articleId);
    res.json(comments);
});

articleCommentsRouter.post('/:id/comments', commentLimiter, isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const articleId = req.params.id;
    const { content } = req.body;
    const { user_id, username } = req.session.user;

    if (!content) {
        return res.status(400).json({ error: 'Comment content is required.' });
    }

    try {
        const articleSettings = await db.get('SELECT comments_disabled FROM articles WHERE article_id = ?', articleId);
        if (articleSettings && articleSettings.comments_disabled) {
            return res.status(403).json({ error: 'Comments are disabled for this article.' });
        }

        // SAFETY: Ensure article row exists before inserting comment to satisfy Foreign Key
        await db.run('INSERT OR IGNORE INTO articles (article_id, likes) VALUES (?, 0)', articleId);

        const result = await db.run(
            'INSERT INTO comments (article_id, author_id, author_name, content) VALUES (?, ?, ?, ?)',
            articleId,
            user_id,
            username,
            content
        );

        const newComment = await db.get(`
            SELECT
                c.comment_id, c.article_id, c.author_id, c.author_name, c.content, c.timestamp, c.edited_at,
                u.custom_avatar, u.is_admin as author_is_admin
            FROM comments c
            LEFT JOIN users u ON c.author_id = u.user_id
            WHERE c.comment_id = ?
        `, result.lastID);
        res.status(201).json(newComment);
    } catch (error) {
        console.error('Error posting comment:', error);
        res.status(500).json({ error: 'An error occurred while posting the comment.' });
    }
});

commentRouter.put('/:commentId', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const commentId = req.params.commentId;
    const { content } = req.body;
    const { user_id, is_admin } = req.session.user;

    if (!content) {
        return res.status(400).json({ error: 'Comment content is required.' });
    }

    try {
        const comment = await db.get('SELECT * FROM comments WHERE comment_id = ?', commentId);
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found.' });
        }

        if (!is_admin && comment.author_id !== user_id) {
            return res.status(403).json({ error: 'You do not have permission to edit this comment.' });
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

commentRouter.delete('/:commentId', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const commentId = req.params.commentId;
    const { user_id, is_admin } = req.session.user;

    try {
        const comment = await db.get('SELECT * FROM comments WHERE comment_id = ?', commentId);
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found.' });
        }

        if (!is_admin && comment.author_id !== user_id) {
            return res.status(403).json({ error: 'You do not have permission to delete this comment.' });
        }

        await db.run('DELETE FROM comments WHERE comment_id = ?', commentId);
        res.status(200).json({ message: 'Comment deleted successfully.' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'An error occurred while deleting the comment.' });
    }
});

module.exports = { articleCommentsRouter, commentRouter };