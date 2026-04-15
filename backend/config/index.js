const path = require('path');

const projectRoot = path.join(__dirname, '../..');

const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(projectRoot, 'data');

const config = {
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',

    session: {
        secret: process.env.SESSION_SECRET || 'dev-only-fallback-secret-do-not-use-in-production',
        maxAge: 24 * 60 * 60 * 1000
    },

    paths: {
        root: projectRoot,
        data: dataDir,
        database: process.env.DATABASE_PATH || path.join(dataDir, 'db/my-database.sqlite'),
        articles: path.join(projectRoot, 'data/articles'),
        articlesImages: path.join(dataDir, 'articles/images'),
        uploads: path.join(dataDir, 'uploads'),
        avatars: path.join(dataDir, 'uploads/avatars'),
        staffUploads: path.join(dataDir, 'uploads/staff'),
        issuesPdfs: path.join(dataDir, 'issues/pdfs'),
        issuesCovers: path.join(dataDir, 'issues/covers')
    },

    upload: {
        maxFileSize: 5 * 1024 * 1024,
        allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    }
};

module.exports = config;
