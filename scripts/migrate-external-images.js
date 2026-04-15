const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const sharp = require('sharp');

const config = require('../backend/config');
const { initializeDatabase } = require('../backend/utils/database');

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const request = client.get(url, { timeout: 30000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadImage(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error(`Timeout downloading ${url}`));
        });
    });
}

function generateFilename() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `image-${dateStr}-${randomSuffix}.webp`;
}

async function processAndSaveImage(buffer, destDir) {
    const filename = generateFilename();
    const destPath = path.join(destDir, filename);

    await sharp(buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(destPath);

    return filename;
}

function replaceExternalUrlsInContent(content, urlToLocalPath) {
    let updated = content;
    for (const [url, localPath] of Object.entries(urlToLocalPath)) {
        updated = updated.split(url).join(localPath);
    }
    return updated;
}

async function main() {
    const db = await initializeDatabase();
    const imagesDir = config.paths.articlesImages;

    await fs.mkdir(imagesDir, { recursive: true });

    const articles = await db.all('SELECT article_id, content FROM article_files');
    console.log(`Found ${articles.length} articles to process.`);

    let totalDownloaded = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalArticlesUpdated = 0;

    for (const article of articles) {
        const { article_id, content } = article;

        const externalUrlRegex = /^ImageFile \d+: (https?:\/\/.+)$/gm;
        const matches = [...content.matchAll(externalUrlRegex)];

        if (matches.length === 0) {
            totalSkipped++;
            continue;
        }

        console.log(`\nArticle: ${article_id} — ${matches.length} external image(s)`);

        const urlToLocalPath = {};

        for (const match of matches) {
            const url = match[1].trim();
            console.log(`  Downloading: ${url}`);

            try {
                const buffer = await downloadImage(url);
                const filename = await processAndSaveImage(buffer, imagesDir);
                const localPath = `data/articles/images/${filename}`;
                urlToLocalPath[url] = localPath;
                console.log(`  Saved as:    ${localPath}`);
                totalDownloaded++;
            } catch (err) {
                console.error(`  FAILED: ${err.message}`);
                totalFailed++;
            }
        }

        if (Object.keys(urlToLocalPath).length > 0) {
            const updatedContent = replaceExternalUrlsInContent(content, urlToLocalPath);
            await db.run(
                'UPDATE article_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE article_id = ?',
                [updatedContent, article_id]
            );
            totalArticlesUpdated++;
        }
    }

    console.log('\n--- Migration Complete ---');
    console.log(`Articles scanned:  ${articles.length}`);
    console.log(`Articles updated:  ${totalArticlesUpdated}`);
    console.log(`Images downloaded: ${totalDownloaded}`);
    console.log(`Images failed:     ${totalFailed}`);
    console.log(`Articles skipped (no external images): ${totalSkipped}`);

    await db.close();
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
