const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const compression = require('compression');
const config = require('./config');
const { initializeDatabase } = require('./utils/database');
const { initializeContent, getSingleArticleById } = require('./utils/content-parser');
const { initScheduler } = require('./utils/scheduler');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const brotliJson = require('./middleware/brotli');
const { csrfMiddleware, csrfProtection } = require('./middleware/csrf');
const { loginLimiter, signupLimiter, contactLimiter, subscribeLimiter, forgotPasswordLimiter } = require('./middleware/rateLimiter');

const SW_VERSION = `v${Date.now()}`;
const swRaw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf-8');
const swContent = swRaw.replace("const CACHE_VERSION = 'v1'", `const CACHE_VERSION = '${SW_VERSION}'`);

const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

const app = express();

if (!process.env.SESSION_SECRET) {
    console.warn('WARNING: SESSION_SECRET environment variable is not set. Using a fallback secret for development only.');
}

app.set('trust proxy', 1);

// Brotli for JSON API responses (applied first, before gzip)
app.use(brotliJson);

// Gzip for everything else (static files, HTML, etc.)
app.use(compression({
    level: 9,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        // Skip if already brotli-encoded
        if (res.getHeader('Content-Encoding') === 'br') return false;
        return compression.filter(req, res);
    }
}));

// Security + performance response headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(express.json({ limit: '10mb' }));

// Ensure persistent data directories exist before anything else touches the filesystem
// (important for fresh Railway deployments where the volume starts empty)
[
    path.dirname(config.paths.database), // Ensure the DB folder exists for sessions.sqlite
    config.paths.uploads,
    config.paths.avatars,
    config.paths.articlesImages,
    config.paths.staffUploads,
    config.paths.issuesPdfs,
    config.paths.issuesCovers
].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Auto-migrate local repository data (like existing database and images) to the Railway volume
if (process.env.DATA_DIR) {
    const repoDataDir = path.join(__dirname, '../data');
    const volumeDataDir = path.resolve(process.env.DATA_DIR);

    function copyMissingFiles(src, dest) {
        if (!fs.existsSync(src)) return;
        if (fs.statSync(src).isDirectory()) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            fs.readdirSync(src).forEach(item => {
                copyMissingFiles(path.join(src, item), path.join(dest, item));
            });
        } else {
            // Only copy if it doesn't exist in the volume so we never overwrite live data
            if (!fs.existsSync(dest)) {
                fs.copyFileSync(src, dest);
                console.log(`[Data Migration] Copied ${path.basename(src)} to volume.`);
            }
        }
    }

    console.log('[Data Migration] Checking for missing files to copy from repository to volume...');
    copyMissingFiles(repoDataDir, volumeDataDir);
}

// Configure session with SQLite store to prevent memory leaks and persist logins
app.use(session({
    store: new SQLiteStore({
        dir: path.dirname(config.paths.database),
        db: 'sessions.sqlite'
    }),
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: config.isProduction,
        httpOnly: true,
        maxAge: config.session.maxAge
    }
}));

// Initialize DB and Content Cache
initializeDatabase().then(async (db) => {
    // Auto-promote a user to admin if ADMIN_USERNAME is set in Railway
    if (process.env.ADMIN_USERNAME) {
        try {
            await db.run('UPDATE users SET is_admin = 1 WHERE username = ?', process.env.ADMIN_USERNAME);
            console.log(`[Admin Setup] Promoted ${process.env.ADMIN_USERNAME} to Admin.`);
        } catch (err) {
            console.error('[Admin Setup] Failed to promote admin:', err);
        }
    }
});
initializeContent();
initScheduler();

app.use('/backend*', (req, res) => {
    res.status(403).json({ error: 'Access denied' });
});

// Set XSRF-TOKEN cookie for all visitors so the frontend can attach it to requests
app.use(csrfMiddleware);

// CSRF token validation for all mutating API requests
app.use('/api', csrfProtection);

// Targeted rate limiters on the most abuse-prone endpoints
app.post('/api/users/login', loginLimiter);
app.post('/api/users/signup', signupLimiter);
app.post('/api/users/forgot-password', forgotPasswordLimiter);
app.post('/api/contact', contactLimiter);
app.post('/api/subscribe', subscribeLimiter);

app.use('/api', apiRouter);
app.use('/api/users', authRouter);
app.use('/api/admin', adminRouter);

const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

// Check the persistent volume for new covers FIRST!
app.use('/assets/images/issue-covers', express.static(config.paths.issuesCovers, {
    maxAge: ONE_YEAR,
    etag: true,
    lastModified: true
}));

// Immutable assets (images, icons, fonts, uploads) — cache 1 year
app.use('/assets', express.static(path.join(__dirname, '../assets'), {
    maxAge: ONE_YEAR,
    immutable: true,
    etag: true,
    lastModified: true
}));

app.use('/uploads', express.static(config.paths.uploads, {
    maxAge: ONE_DAY,
    etag: true,
    lastModified: true
}));

// JS and CSS — use no-cache to force revalidation. This prevents the browser's
// HTTP cache from swallowing SW fetch requests and trapping old code.
app.use('/css', express.static(path.join(__dirname, '../css'), {
    setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
    etag: true,
    lastModified: true
}));

app.use('/js', express.static(path.join(__dirname, '../js'), {
    setHeaders: res => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
    etag: true,
    lastModified: true
}));

// Article images — served from the volume (uploaded via admin)
app.use('/data/articles/images', express.static(config.paths.articlesImages, {
    maxAge: ONE_YEAR,
    immutable: true,
    etag: true,
    lastModified: true
}));

// Issues PDF and JSON — mutated by admin writes, served from volume
app.use('/data/issues', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
}, express.static(path.join(config.paths.data, 'issues'), { etag: true, lastModified: true }));

// Other data files (staff images etc.) — served from the committed repo
app.use('/data', express.static(path.join(__dirname, '../data'), {
    maxAge: ONE_HOUR,
    etag: true,
    lastModified: true
}));

app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(swContent);
});

app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: ONE_DAY,
    etag: true
}));

// Dynamic Open Graph meta tag injection for article pages so that social
// media bots (iMessage, Twitter, Discord, etc.) see the correct title,
// description and image instead of the generic index.html shell.
app.get('/article/:id', async (req, res) => {
    try {
        const article = await getSingleArticleById(req.params.id, false);

        if (article) {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const title = `${article.title} | ANDOVERVIEW`;
            const description = (article.seoDescription || article.description || 'Read this article on ANDOVERVIEW, the Andover High School student newspaper.').slice(0, 200);
            const rawImage = article.image || '';
            const imageUrl = rawImage
                ? (rawImage.startsWith('http://') || rawImage.startsWith('https://') ? rawImage : `${baseUrl}/${rawImage}`)
                : `${baseUrl}/assets/images/logo.png`;
            const pageUrl = `${baseUrl}/article/${article.id}`;

            const ogTags = [
                `<meta property="og:type" content="article">`,
                `<meta property="og:title" content="${title.replace(/"/g, '&quot;')}">`,
                `<meta property="og:description" content="${description.replace(/"/g, '&quot;')}">`,
                `<meta property="og:image" content="${imageUrl}">`,
                `<meta property="og:url" content="${pageUrl}">`,
                `<meta property="og:site_name" content="ANDOVERVIEW">`,
                `<meta name="twitter:card" content="summary_large_image">`,
                `<meta name="twitter:title" content="${title.replace(/"/g, '&quot;')}">`,
                `<meta name="twitter:description" content="${description.replace(/"/g, '&quot;')}">`,
                `<meta name="twitter:image" content="${imageUrl}">`,
                `<title>${title.replace(/</g, '&lt;')}</title>`,
            ].join('\n    ');

            const injected = indexHtml
                .replace(/<title>[^<]*<\/title>/, '')
                .replace('</head>', `    ${ogTags}\n</head>`);

            res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(injected);
        }
    } catch (err) {
        console.error('OG tag injection error for article', req.params.id, err);
    }

    // Fall through to the generic shell if article not found or on error
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Serve index.html for client-side routing — no cache so users always get fresh shell
app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    // Hint browser to preload critical resources
    res.setHeader('Link', [
        '</css/main.css>; rel=preload; as=style',
        '</js/lib/app.js>; rel=modulepreload',
        '</js/lib/router.js>; rel=modulepreload',
        '</js/lib/api.js>; rel=modulepreload',
        '</js/lib/auth.js>; rel=modulepreload',
    ].join(', '));
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.use((err, req, res, next) => {
    if (err && err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Image file is too large. Maximum size is 50 MB per file.' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err && err.status === 413) {
        return res.status(413).json({ error: 'Request body too large.' });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: err?.message || 'Internal server error.' });
});

app.listen(config.port, '0.0.0.0', () => {
    console.log(`Server is running and listening on 0.0.0.0:${config.port}`);
});