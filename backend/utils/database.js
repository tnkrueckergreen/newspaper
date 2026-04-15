const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

let dbPromise = null;

const STAFF_SEED_PATH = path.join(path.resolve(__dirname, '../..'), 'data/staff/staff.json');
const ISSUES_SEED_PATH = path.join(path.resolve(__dirname, '../..'), 'data/issues/issues.json');

async function seedInitialData(db) {
    const staffCount = await db.get('SELECT COUNT(*) as count FROM staff');
    if (staffCount.count === 0) {
        try {
            const raw = fs.readFileSync(STAFF_SEED_PATH, 'utf-8');
            const staffMembers = JSON.parse(raw);
            let sortOrder = 0;

            for (const person of staffMembers) {
                if (person.name) {
                    await db.run(
                        'INSERT INTO staff (name, role, image, bio, sort_order) VALUES (?, ?, ?, ?, ?)',
                        person.name, person.role || '', person.image || '', person.bio || '', sortOrder++
                    );
                }
            }
            console.log(`Seeded ${staffMembers.length} staff member(s) into database.`);
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('Staff seed error:', err);
        }
    }

    const issuesCount = await db.get('SELECT COUNT(*) as count FROM issues');
    if (issuesCount.count === 0) {
        try {
            const raw = fs.readFileSync(ISSUES_SEED_PATH, 'utf-8');
            const issues = JSON.parse(raw);
            for (const issue of issues) {
                await db.run(
                    'INSERT OR IGNORE INTO issues (name, date, filename) VALUES (?, ?, ?)',
                    issue.name, issue.date, issue.filename
                );
            }
            console.log(`Seeded ${issues.length} issue(s) into database.`);
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('Issues seed error:', err);
        }
    }
}

async function initializeDatabase() {
    if (!dbPromise) {
        dbPromise = (async () => {
            try {
                const dbDir = path.dirname(config.paths.database);
                if (!fs.existsSync(dbDir)) {
                    fs.mkdirSync(dbDir, { recursive: true });
                }

                const db = await open({
                    filename: config.paths.database,
                    driver: sqlite3.Database
                });

                await db.exec(`
                    CREATE TABLE IF NOT EXISTS users (
                        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        custom_avatar TEXT,
                        is_admin INTEGER DEFAULT 0,
                        email TEXT UNIQUE
                    );

                    CREATE TABLE IF NOT EXISTS password_reset_tokens (
                        token TEXT PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        expires_at DATETIME NOT NULL,
                        used INTEGER DEFAULT 0,
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS articles (
                        article_id TEXT PRIMARY KEY,
                        likes INTEGER NOT NULL DEFAULT 0,
                        comments_disabled INTEGER NOT NULL DEFAULT 0
                    );

                    CREATE TABLE IF NOT EXISTS comments (
                        comment_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        article_id TEXT NOT NULL,
                        author_id INTEGER NOT NULL,
                        author_name TEXT NOT NULL,
                        content TEXT NOT NULL,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        edited_at DATETIME,
                        FOREIGN KEY (article_id) REFERENCES articles(article_id) ON DELETE CASCADE,
                        FOREIGN KEY (author_id) REFERENCES users(user_id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS user_likes (
                        like_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        article_id TEXT NOT NULL,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                        FOREIGN KEY (article_id) REFERENCES articles(article_id) ON DELETE CASCADE,
                        UNIQUE(user_id, article_id)
                    );

                    CREATE TABLE IF NOT EXISTS user_bookmarks (
                        bookmark_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        article_id TEXT NOT NULL,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                        FOREIGN KEY (article_id) REFERENCES articles(article_id) ON DELETE CASCADE,
                        UNIQUE(user_id, article_id)
                    );

                    CREATE TABLE IF NOT EXISTS user_article_views (
                        view_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        article_id TEXT NOT NULL,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                        FOREIGN KEY (article_id) REFERENCES articles(article_id) ON DELETE CASCADE,
                        UNIQUE(user_id, article_id)
                    );

                    CREATE TABLE IF NOT EXISTS subscriptions (
                        subscription_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT NOT NULL UNIQUE,
                        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS contacts (
                        contact_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        email TEXT NOT NULL,
                        website TEXT,
                        message TEXT NOT NULL,
                        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS article_files (
                        article_id TEXT PRIMARY KEY,
                        content TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS staff (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        role TEXT NOT NULL DEFAULT '',
                        image TEXT NOT NULL DEFAULT '',
                        bio TEXT NOT NULL DEFAULT '',
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS issues (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        date TEXT NOT NULL,
                        filename TEXT NOT NULL UNIQUE,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS article_drafts (
                        draft_key TEXT PRIMARY KEY,
                        data TEXT NOT NULL,
                        saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `);

                await db.run(`
                    ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0
                `).catch(() => {});

                await db.run(`
                    ALTER TABLE users ADD COLUMN email TEXT
                `).catch(() => {});

                await db.run(`
                    ALTER TABLE subscriptions ADD COLUMN unsubscribe_token TEXT
                `).catch(() => {});

                await db.run(`
                    ALTER TABLE articles ADD COLUMN comments_disabled INTEGER NOT NULL DEFAULT 0
                `).catch(() => {});

                const tokenlessSubscribers = await db.all(
                    'SELECT subscription_id FROM subscriptions WHERE unsubscribe_token IS NULL'
                );
                for (const row of tokenlessSubscribers) {
                    await db.run(
                        'UPDATE subscriptions SET unsubscribe_token = ? WHERE subscription_id = ?',
                        crypto.randomBytes(32).toString('hex'),
                        row.subscription_id
                    );
                }

                await db.exec(`
                    CREATE INDEX IF NOT EXISTS idx_comments_article
                        ON comments(article_id);
                    CREATE INDEX IF NOT EXISTS idx_user_likes_user
                        ON user_likes(user_id, article_id);
                    CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user
                        ON user_bookmarks(user_id, article_id);
                    CREATE INDEX IF NOT EXISTS idx_user_views_article
                        ON user_article_views(article_id);
                    CREATE INDEX IF NOT EXISTS idx_user_views_user
                        ON user_article_views(user_id, article_id);
                    CREATE INDEX IF NOT EXISTS idx_articles_likes
                        ON articles(likes DESC);
                    CREATE INDEX IF NOT EXISTS idx_staff_sort
                        ON staff(sort_order, id);
                    CREATE INDEX IF NOT EXISTS idx_issues_date
                        ON issues(date DESC);
                `);

                await seedInitialData(db);

                console.log('Database initialized successfully.');
                return db;
            } catch (error) {
                dbPromise = null;
                console.error('Failed to initialize database:', error);
                process.exit(1);
            }
        })();
    }

    return dbPromise;
}

module.exports = { initializeDatabase };