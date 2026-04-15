const express = require('express');
const articlesRouter = require('./articles');
const engagementRouter = require('./engagement');
const { articleCommentsRouter, commentRouter } = require('./comments');
const accountRouter = require('./account');
const subscribeRouter = require('./subscribe');
const unsubscribeRouter = require('./unsubscribe');
const contactRouter = require('./contact');
const { initializeDatabase } = require('../../utils/database');

const router = express.Router();

router.use('/articles', articlesRouter);
router.use('/articles', engagementRouter);
router.use('/articles', articleCommentsRouter);
router.use('/comments', commentRouter);
router.use('/account', accountRouter);
router.use('/subscribe', subscribeRouter);
router.use('/unsubscribe', unsubscribeRouter);
router.use('/contact', contactRouter);

router.get('/issues', async (req, res) => {
    try {
        const db = await initializeDatabase();
        const issues = await db.all('SELECT id, name, date, filename FROM issues ORDER BY date DESC, id DESC');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.json(issues);
    } catch (error) {
        console.error('Error fetching public issues:', error);
        res.status(500).json({ error: 'Failed to retrieve issues.' });
    }
});

module.exports = router;
