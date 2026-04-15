const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const dbPath = './data/db/my-database.sqlite';
const imagesDir = './data/articles/images';

const db = new sqlite3.Database(dbPath);

db.all('SELECT content FROM article_files', [], (err, rows) => {
    if (err) {
        console.error("DB Error:", err);
        return;
    }

    const referencedImages = new Set();
    rows.forEach(row => {
        // Extract the exact filenames used in the markdown
        const regex = /(?:data\/articles\/images\/)?(image-[A-Za-z0-9-]+\.webp)/g;
        let match;
        while ((match = regex.exec(row.content)) !== null) {
            referencedImages.add(match[1]);
        }
    });

    const files = fs.readdirSync(imagesDir);
    let orphans = 0;

    files.forEach(file => {
        if (file.endsWith('.webp') && !referencedImages.has(file)) {
            fs.unlinkSync(path.join(imagesDir, file));
            orphans++;
        }
    });

    console.log(`\n✅ Cleanup complete!`);
    console.log(`Total images scanned: ${files.length}`);
    console.log(`Images actively used in articles: ${referencedImages.size}`);
    console.log(`Orphaned ghost images deleted: ${orphans}\n`);
});
