const express = require('express');
const { initializeDatabase } = require('../../utils/database.js');
const { isAuthenticated } = require('../../middleware/auth.js');
const { getCombinedData, getPublicSummaries, getSingleArticleById, searchArticles, getRecommendations } = require('../../utils/content-parser.js');

const router = express.Router();

// Get Article Summaries (Lightweight) — supports ?page=1&limit=20 for pagination
router.get('/', async (req, res) => {
    const db = await initializeDatabase();

    const pageParam = parseInt(req.query.page, 10);
    const limitParam = parseInt(req.query.limit, 10);
    const paginated = !isNaN(pageParam) && !isNaN(limitParam) && pageParam > 0 && limitParam > 0;

    const { articles, staff } = await getPublicSummaries();
    let articlesWithData = [];

    try {
        const dbArticles = await db.all('SELECT article_id, likes, comments_disabled FROM articles');
        const likesMap = new Map();
        const commentsDisabledMap = new Map();
        dbArticles.forEach(row => {
            likesMap.set(row.article_id, row.likes);
            commentsDisabledMap.set(row.article_id, !!row.comments_disabled);
        });

        articlesWithData = articles.map(article => {
            const likes = likesMap.get(article.id) || 0;
            return { ...article, likes, comments_disabled: commentsDisabledMap.get(article.id) || false };
        });

        if (req.session.user) {
            const userId = req.session.user.user_id;
            const [userLikes, userBookmarks] = await Promise.all([
                db.all('SELECT article_id FROM user_likes WHERE user_id = ?', userId),
                db.all('SELECT article_id FROM user_bookmarks WHERE user_id = ?', userId)
            ]);

            const likedSet = new Set(userLikes.map(l => l.article_id));
            const bookmarkedSet = new Set(userBookmarks.map(b => b.article_id));

            articlesWithData = articlesWithData.map(article => ({
                ...article,
                user_has_liked: likedSet.has(article.id),
                user_has_bookmarked: bookmarkedSet.has(article.id)
            }));
        }

        // Cache for anonymous users — authenticated responses contain user-specific data
        if (!req.session.user) {
            res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
        } else {
            res.setHeader('Cache-Control', 'private, no-cache');
        }

        if (paginated) {
            const total = articlesWithData.length;
            const start = (pageParam - 1) * limitParam;
            const pageArticles = articlesWithData.slice(start, start + limitParam);
            return res.json({
                articles: pageArticles,
                staff,
                total,
                page: pageParam,
                limit: limitParam,
                hasMore: start + limitParam < total
            });
        }

        res.json({ articles: articlesWithData, staff });

    } catch (error) {
        console.error('Error fetching articles:', error);
        res.status(500).json({ error: 'Failed to retrieve article data.' });
    }
});

// Server-Side Search Endpoint
router.get('/search', async (req, res) => {
    const query = req.query.q || '';
    if (query.length < 2) return res.json([]);

    try {
        const results = await searchArticles(query);
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
        res.json(results);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get Recommendations for an Article
router.get('/:id/recommendations', async (req, res) => {
    try {
        const results = await getRecommendations(req.params.id);
        res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
        res.json(results);
    } catch (error) {
        console.error('Recommendation error:', error);
        res.status(500).json({ error: 'Failed to fetch recommendations' });
    }
});

// Get Full Single Article (Heavy content)
router.get('/:id', async (req, res) => {
    const db = await initializeDatabase();
    const articleId = req.params.id;

    try {
        const article = await getSingleArticleById(articleId, false);

        if (!article) {
            return res.status(404).json({ error: 'Article not found.' });
        }

        let dynamicData = await db.get('SELECT likes, comments_disabled FROM articles WHERE article_id = ?', articleId);
        const likes = dynamicData ? dynamicData.likes : 0;
        const commentsDisabled = dynamicData ? !!dynamicData.comments_disabled : false;

        const fullArticle = { ...article, likes, comments_disabled: commentsDisabled };

        if (req.session.user) {
            const userId = req.session.user.user_id;
            const [hasLiked, hasBookmarked] = await Promise.all([
                db.get('SELECT 1 FROM user_likes WHERE user_id = ? AND article_id = ?', userId, articleId),
                db.get('SELECT 1 FROM user_bookmarks WHERE user_id = ? AND article_id = ?', userId, articleId)
            ]);

            fullArticle.user_has_liked = !!hasLiked;
            fullArticle.user_has_bookmarked = !!hasBookmarked;
            
            res.setHeader('Cache-Control', 'private, no-cache');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=300');
        }

        res.json(fullArticle);

    } catch (error) {
        console.error('Error fetching single article:', error);
        res.status(500).json({ error: 'Failed to fetch article.' });
    }
});

router.post('/:id/view', isAuthenticated, async (req, res) => {
    const db = await initializeDatabase();
    const articleId = req.params.id;
    const { user_id } = req.session.user;

    try {
        await db.run('INSERT OR IGNORE INTO articles (article_id, likes) VALUES (?, 0)', articleId);
        await db.run('INSERT OR IGNORE INTO user_article_views (user_id, article_id) VALUES (?, ?)', user_id, articleId);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error tracking article view:', error);
        res.status(500).json({ error: 'An error occurred while tracking the view.' });
    }
});

module.exports = router;