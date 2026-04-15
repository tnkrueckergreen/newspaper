// andoverview/backend/utils/content-parser.js
const fs = require('fs').promises;
const { initializeDatabase } = require('./database');

const ANDOVERVIEW_STAFF_MEMBER = {
    id: 0,
    name: "ANDOVERVIEW",
    role: "Editorial Board",
    image: "assets/icons/andoverview-avatar.svg",
    bio: "This editorial represents the collective voice and viewpoint of the ANDOVERVIEW student newspaper staff.",
    authorLink: "#articles-page-editorial"
};

const ROLE_ORDER = [
    "Editor-in-Chief", "Managing Editor", "Sports Editor", "Opinion Editor", "Arts Editor",
    "Editorial Board", "Photographer", "Staff Writer", "Contributor"
];

const VALID_PLACEMENT_BASES = new Set([
    'Top Left', 'Top Center', 'Top Right',
    'Bottom Center', 'Bottom Left', 'Bottom Right',
    'Custom Left', 'Custom Center', 'Custom Right',
    'Gallery Top', 'Gallery Bottom', 'Gallery Custom'
]);

let memoryCache = {
    articles: [],
    staff: [],
    publicSummaries: [],
    isLoaded: false
};

let initPromise = null;
let reloadPromise = null;

function isValueNA(value) {
    return !value || value.trim().toLowerCase() === 'n/a';
}

function smartQuotes(text) {
    if (!text || typeof text !== 'string') return text || '';
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const prev = result.length > 0 ? result[result.length - 1] : '';
        const next = i < text.length - 1 ? text[i + 1] : '';
        if (ch === '"') {
            result += (!prev || /[\s\(\[\{]/.test(prev)) ? '\u201C' : '\u201D';
        } else if (ch === "'") {
            if (/\w/.test(prev) && /\w/.test(next)) {
                result += '\u2019';
            } else if (!prev || /[\s\(\[\{]/.test(prev)) {
                result += '\u2018';
            } else {
                result += '\u2019';
            }
        } else {
            result += ch;
        }
    }
    return result;
}

function smartQuotesMarkdown(text) {
    if (!text || typeof text !== 'string') return text || '';
    const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    return parts.map((part, i) => i % 2 === 0 ? smartQuotes(part) : part).join('');
}

function splitMultiValueString(str) {
    if (isValueNA(str)) return [];
    const normalizedStr = str.replace(/\s+and\s+/gi, ',').replace(/\s*&\s*/g, ',');
    return normalizedStr.split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);
}

function generateArticleId(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function stringifyArticle(articleData) {
    const {
        title, authors, category, tags, date, description, content, status, images, embeds,
        slug, seoTitle, seoDescription, featured, breaking, pinned, scheduledAt
    } = articleData;

    const authorNames = authors.map(a => a.name).join(', ');
    const authorRoles = authors.map(a => a.role).join(', ');
    const safeDescription = (description || '').toString().replace(/[\r\n]+/g, ' ');

    let fileContent = `Title: ${title}\n`;
    fileContent += `Author: ${authorNames}\n`;
    fileContent += `Position: ${authorRoles}\n`;
    fileContent += `Category: ${category}\n`;
    fileContent += `Date: ${date}\n`;
    fileContent += `Tags: ${Array.isArray(tags) ? tags.join(', ') : tags}\n`;
    fileContent += `Description: ${safeDescription}\n`;
    fileContent += `Status: ${status || 'Published'}\n`;
    if (status === 'Scheduled' && scheduledAt) fileContent += `ScheduledAt: ${scheduledAt}\n`;

    if (slug) fileContent += `Slug: ${slug}\n`;
    if (seoTitle) fileContent += `SeoTitle: ${seoTitle}\n`;
    if (seoDescription) fileContent += `SeoDescription: ${(seoDescription || '').replace(/[\r\n]+/g, ' ')}\n`;
    if (featured) fileContent += `Featured: true\n`;
    if (breaking) fileContent += `Breaking: true\n`;
    if (pinned) fileContent += `Pinned: true\n`;

    if (Array.isArray(images)) {
        images.forEach((img, index) => {
            const counter = index + 1;
            if (img.file) {
                fileContent += `ImageFile ${counter}: ${img.file}\n`;
                fileContent += `ImagePlacement ${counter}: ${img.placement || 'Top Center'}\n`;
                if (img.caption) fileContent += `ImageCaption ${counter}: ${img.caption}\n`;
                if (img.credit) fileContent += `ImageCredit ${counter}: ${img.credit}\n`;
                if (img.alt) fileContent += `ImageAlt ${counter}: ${img.alt}\n`;
            }
        });
    }

    if (Array.isArray(embeds)) {
        embeds.forEach((emb, index) => {
            const counter = index + 1;
            if (emb.code && emb.code.trim()) {
                fileContent += `EmbedCode ${counter}: ${emb.code.replace(/[\r\n]+/g, ' ')}\n`;
                fileContent += `EmbedPlacement ${counter}: ${emb.placement || 'Top Center'}\n`;
                if (emb.width) fileContent += `EmbedWidth ${counter}: ${emb.width}\n`;
                if (emb.height) fileContent += `EmbedHeight ${counter}: ${emb.height}\n`;
            }
        });
    }

    fileContent += `\n${content}`;
    return fileContent;
}

function parseArticleContent(content, id) {
    const article = { id, images: [] };
    const txt = content;

    const separatorMatch = txt.match(/^\s*---\s*$|\n\s*\n/m);
    const contentIndex = separatorMatch ? separatorMatch.index + separatorMatch[0].length : -1;

    let frontmatterText, markdownContent;
    if (contentIndex === -1) {
        if (txt.includes(':')) {
            frontmatterText = txt;
            markdownContent = '';
        } else {
            frontmatterText = '';
            markdownContent = txt;
        }
    } else {
        frontmatterText = txt.substring(0, contentIndex);
        markdownContent = txt.substring(contentIndex);
    }

    const frontmatter = {};
    if (frontmatterText) {
        frontmatterText.split('\n').forEach(line => {
            const separatorIndex = line.indexOf(':');
            if (separatorIndex > 0) {
                const key = line.substring(0, separatorIndex).trim().toLowerCase();
                const value = line.substring(separatorIndex + 1).trim();
                frontmatter[key] = value;
            }
        });
    }

    article.title = isValueNA(frontmatter.title) ? 'Untitled Article' : frontmatter.title;
    const rawDescription = isValueNA(frontmatter.description) ? '' : frontmatter.description;
    article.rawDescription = rawDescription;
    article.description = rawDescription;

    article.date = isValueNA(frontmatter.date) ? '' : frontmatter.date;
    if (article.date && isNaN(new Date(article.date).getTime())) {
        console.warn(`[content-parser] Unparseable date "${article.date}" in article — clearing to empty.`);
        article.date = '';
    }

    article.display = isValueNA(frontmatter.display) ? 'recent' : frontmatter.display;
    article.status = frontmatter.status ? frontmatter.status : 'Published';

    article.scheduledAt = frontmatter.scheduledat || null;
    article.slug = frontmatter.slug || null;
    article.seoTitle = frontmatter.seotitle || null;
    article.seoDescription = frontmatter.seodescription || null;
    article.featured = frontmatter.featured === 'true';
    article.breaking = frontmatter.breaking === 'true';
    article.pinned = frontmatter.pinned === 'true';

    article.author = splitMultiValueString(frontmatter.author);
    article.tags = splitMultiValueString(frontmatter.tags);
    article.positions = splitMultiValueString(frontmatter.position);

    const categories = splitMultiValueString(frontmatter.category);
    const specificCategories = categories.filter(c => c.toLowerCase() !== 'articles');
    article.category = specificCategories[0] || categories[0] || 'Uncategorized';
    article.categories = categories;

    const imageMap = new Map();

    Object.keys(frontmatter).forEach(key => {
        if (key.startsWith('imagefile')) {
            const parts = key.split(/\s+/);
            if (parts.length > 1) {
                const index = parseInt(parts[1], 10);
                if (!isNaN(index)) {
                    if (!imageMap.has(index)) imageMap.set(index, {});
                    imageMap.get(index).file = frontmatter[key];
                }
            } else if (key === 'imagefile') {
                if (!imageMap.has(1)) imageMap.set(1, {});
                imageMap.get(1).file = frontmatter[key];
            }
        } else if (key.startsWith('imageplacement') || key.startsWith('imagecaption') || key.startsWith('imagecredit') || key.startsWith('imagealt')) {
            const parts = key.split(/\s+/);
            const propName = parts[0].replace('image', '');
            let index = 1;
            if (parts.length > 1) {
                index = parseInt(parts[1], 10);
            }
            if (!isNaN(index)) {
                if (!imageMap.has(index)) imageMap.set(index, {});
                imageMap.get(index)[propName] = frontmatter[key];
            }
        }
    });

    const sortedIndices = Array.from(imageMap.keys()).sort((a, b) => a - b);

    article.images = sortedIndices.map(index => {
        const img = imageMap.get(index);
        if (isValueNA(img.file)) return null;

        let placement = img.placement || 'Top Center';

        const basePlacement = placement.replace(/\s+\d+$/, '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        if (!VALID_PLACEMENT_BASES.has(basePlacement)) {
            placement = 'Top Center';
        } else {
            const numMatch = placement.match(/\d+$/);
            placement = numMatch ? `${basePlacement} ${numMatch[0]}` : basePlacement;
        }

        return {
            file: img.file,
            placement: placement,
            caption: isValueNA(img.caption) ? '' : img.caption,
            credit: isValueNA(img.credit) ? '' : img.credit,
            alt: isValueNA(img.alt) ? '' : (img.alt || '')
        };
    }).filter(Boolean);

    if (article.images.length === 0 && !isValueNA(frontmatter.image)) {
        article.images.push({
            file: frontmatter.image,
            placement: 'Top Center',
            caption: isValueNA(frontmatter.imagecaption) ? '' : frontmatter.imagecaption,
            credit: isValueNA(frontmatter.imagecredit) ? '' : frontmatter.imagecredit
        });
    }

    if (article.images.length > 0) {
        article.image = article.images[0].file;
    }

    const embedMap = new Map();
    Object.keys(frontmatter).forEach(key => {
        if (key.startsWith('embedcode') || key.startsWith('embedplacement') || key.startsWith('embedwidth') || key.startsWith('embedheight')) {
            const parts = key.split(/\s+/);
            const propName = parts[0].replace('embed', '');
            let index = 1;
            if (parts.length > 1) index = parseInt(parts[1], 10);
            if (!isNaN(index)) {
                if (!embedMap.has(index)) embedMap.set(index, {});
                embedMap.get(index)[propName] = frontmatter[key];
            }
        }
    });
    const sortedEmbedIndices = Array.from(embedMap.keys()).sort((a, b) => a - b);
    article.embeds = sortedEmbedIndices.map(index => {
        const emb = embedMap.get(index);
        if (!emb.code || isValueNA(emb.code)) return null;
        let placement = emb.placement || 'Top Center';
        const basePlacement = placement.replace(/\s+\d+$/, '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        if (!VALID_PLACEMENT_BASES.has(basePlacement)) placement = 'Top Center';
        else {
            const numMatch = placement.match(/\d+$/);
            placement = numMatch ? `${basePlacement} ${numMatch[0]}` : basePlacement;
        }
        return {
            code: emb.code,
            placement,
            width: emb.width || '100%',
            height: emb.height || '560'
        };
    }).filter(Boolean);

    article.content = markdownContent;

    article.searchableText = [
        article.title,
        article.description,
        article.author.join(' '),
        article.tags.join(' '),
        article.category,
        markdownContent
    ].join(' ').toLowerCase();

    return article;
}

async function saveArticleFile(articleData, existingId = null) {
    const db = await initializeDatabase();
    const content = stringifyArticle(articleData);

    if (existingId) {
        await db.run(
            `INSERT INTO article_files (article_id, content, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(article_id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP`,
            existingId,
            content
        );
        await reloadContent();
        return existingId;
    }

    const baseId = generateArticleId(articleData.title);
    let articleId = baseId;
    let counter = 1;

    while (true) {
        const result = await db.run(
            `INSERT OR IGNORE INTO article_files (article_id, content, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)`,
            articleId,
            content
        );
        if (result.changes > 0) break;
        articleId = `${baseId}-${counter}`;
        counter++;
    }

    await reloadContent();
    return articleId;
}

async function deleteArticleFile(articleId) {
    const db = await initializeDatabase();
    const result = await db.run('DELETE FROM article_files WHERE article_id = ?', articleId);
    if (result.changes === 0) return false;
    await reloadContent();
    return true;
}

async function updateArticleStatus(articleId, newStatus, { skipReload = false } = {}) {
    const db = await initializeDatabase();
    const row = await db.get('SELECT content FROM article_files WHERE article_id = ?', articleId);

    if (!row) throw new Error(`Article not found: ${articleId}`);

    let content = row.content;
    const statusRegex = /^Status:.*$/m;
    if (statusRegex.test(content)) {
        content = content.replace(statusRegex, `Status: ${newStatus}`);
    } else {
        content = content.replace(/^Title:.*$/m, (match) => `${match}\nStatus: ${newStatus}`);
    }

    await db.run(
        'UPDATE article_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE article_id = ?',
        content,
        articleId
    );

    if (!skipReload) await reloadContent();
    return newStatus;
}

async function updateArticleFeatured(articleId, featured) {
    const db = await initializeDatabase();
    const row = await db.get('SELECT content FROM article_files WHERE article_id = ?', articleId);

    if (!row) throw new Error(`Article not found: ${articleId}`);

    let content = row.content;
    const featuredRegex = /^Featured:.*\n?/m;

    if (featured) {
        if (featuredRegex.test(content)) {
            content = content.replace(featuredRegex, `Featured: true\n`);
        } else {
            content = content.replace(/^Status:.*$/m, (match) => `${match}\nFeatured: true`);
        }
    } else {
        content = content.replace(featuredRegex, '');
    }

    await db.run(
        'UPDATE article_files SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE article_id = ?',
        content,
        articleId
    );

    await reloadContent();
    return featured;
}

async function getStaffFromDb() {
    const db = await initializeDatabase();
    const rows = await db.all('SELECT * FROM staff ORDER BY sort_order, id');
    return rows.map(row => ({
        id: row.id,
        name: row.name,
        role: row.role,
        image: row.image || 'assets/icons/placeholder-staff.svg',
        bio: row.bio || ''
    }));
}

async function loadAllFromDb() {
    const db = await initializeDatabase();
    try {
        const rows = await db.all('SELECT article_id, content, created_at FROM article_files');

        let articles = rows.map(row => {
            try {
                const parsed = parseArticleContent(row.content, row.article_id);
                parsed._createdAt = row.created_at;
                return parsed;
            } catch (e) {
                console.error(`Failed to parse article ${row.article_id}`, e);
                return null;
            }
        }).filter(Boolean);

        articles.sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            if (dateB !== dateA) return dateB - dateA;
            return new Date(b._createdAt || 0).getTime() - new Date(a._createdAt || 0).getTime();
        });

        const staff = await getStaffFromDb();
        const staffMap = new Map(staff.map(s => [s.name.toLowerCase(), s]));

        const articlesWithWriters = articles.map(article => {
            const isEditorial = article.categories && article.categories.some(c => c.toLowerCase() === 'editorial');
            if (isEditorial) {
                return { ...article, writers: [{ ...ANDOVERVIEW_STAFF_MEMBER, isCurrentStaff: true }] };
            }
            const authorNames = article.author || [];
            const writers = authorNames.map((authorName, index) => {
                let writer;
                const positions = article.positions || [];
                const historicalPosition = positions.length === 1 && authorNames.length > 1
                    ? positions[0]
                    : positions[index];

                if (authorName.toUpperCase() === 'ANDOVERVIEW') {
                    writer = { ...ANDOVERVIEW_STAFF_MEMBER, isCurrentStaff: true };
                    if (historicalPosition && !isValueNA(historicalPosition) && historicalPosition !== writer.role) {
                        writer.role = historicalPosition;
                    }
                } else {
                    const writerData = staffMap.get(authorName.toLowerCase());
                    if (writerData) {
                        writer = { ...writerData, isCurrentStaff: true };
                        if (historicalPosition && !isValueNA(historicalPosition) && historicalPosition !== writerData.role) {
                            writer.role = historicalPosition;
                        }
                    } else {
                        const formerWriter = { name: authorName, isCurrentStaff: false };
                        if (historicalPosition && !isValueNA(historicalPosition)) formerWriter.role = historicalPosition;
                        writer = formerWriter;
                    }
                }
                if (!writer.image) writer.image = 'assets/icons/placeholder-avatar.svg';
                return writer;
            });

            writers.sort((a, b) => {
                if (a.isCurrentStaff && !b.isCurrentStaff) return -1;
                if (!a.isCurrentStaff && b.isCurrentStaff) return 1;
                if (a.isCurrentStaff && b.isCurrentStaff) {
                    const roleIndexA = ROLE_ORDER.indexOf(a.role);
                    const roleIndexB = ROLE_ORDER.indexOf(b.role);
                    if (roleIndexA !== roleIndexB) {
                        return (roleIndexA === -1 ? 999 : roleIndexA) - (roleIndexB === -1 ? 999 : roleIndexB);
                    }
                }
                return a.name.localeCompare(b.name);
            });
            return { ...article, writers };
        });

        const publicSummaries = articlesWithWriters
            .filter(a => a.status !== 'Unpublished' && a.status !== 'Scheduled')
            .map(a => {
                const { content, searchableText, ...summary } = a;
                return {
                    ...summary,
                    writers: summary.writers ? summary.writers.map(({ bio, ...w }) => w) : summary.writers
                };
            });

        const articlesForMemory = articlesWithWriters.map(article => {
            const { content, _createdAt, ...articleWithoutContent } = article;
            return articleWithoutContent;
        });

        return {
            articles: articlesForMemory,
            staff,
            publicSummaries
        };

    } catch (error) {
        console.error("Critical error loading content:", error);
        return { articles: [], staff: [], publicSummaries: [] };
    }
}

async function initializeContent() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        console.log("Loading content into memory...");
        const data = await loadAllFromDb();
        memoryCache = { ...data, isLoaded: true };
        console.log(`Content loaded: ${memoryCache.articles.length} articles.`);
    })().finally(() => { initPromise = null; });
    return initPromise;
}

async function reloadContent() {
    if (reloadPromise) return reloadPromise;
    reloadPromise = (async () => {
        console.log("Reloading content into memory...");
        const data = await loadAllFromDb();
        memoryCache = { ...data, isLoaded: true };
        console.log(`Content reloaded: ${memoryCache.articles.length} articles.`);
    })().finally(() => { reloadPromise = null; });
    return reloadPromise;
}

async function getCombinedData(includeUnpublished = false) {
    if (!memoryCache.isLoaded) {
        await initializeContent();
    }

    if (includeUnpublished) {
        return {
            articles: memoryCache.articles,
            staff: memoryCache.staff
        };
    } else {
        return {
            articles: memoryCache.articles.filter(a => a.status !== 'Unpublished' && a.status !== 'Scheduled'),
            staff: memoryCache.staff
        };
    }
}

async function getPublicSummaries() {
    if (!memoryCache.isLoaded) {
        await initializeContent();
    }
    return {
        articles: memoryCache.publicSummaries,
        staff: memoryCache.staff
    };
}

function normalizeForSearch(str) {
    return str
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u0027]/g, '')
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036\u0022]/g, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[-]/g, ' ')
        .toLowerCase();
}

async function searchArticles(query) {
    if (!memoryCache.isLoaded) {
        await initializeContent();
    }
    const normalizedQuery = normalizeForSearch(query);

    const results = memoryCache.articles
        .filter(a => a.status !== 'Unpublished' && a.status !== 'Scheduled')
        .filter(a => a.searchableText && normalizeForSearch(a.searchableText).includes(normalizedQuery));

    return results.map(a => {
        const { content, searchableText, ...summary } = a;
        return summary;
    });
}

async function getRecommendations(articleId, limit = 4) {
    if (!memoryCache.isLoaded) {
        await initializeContent();
    }

    const allArticles = memoryCache.publicSummaries;
    const currentArticle = memoryCache.articles.find(a => a.id === articleId);

    if (!currentArticle) return [];

    const calculateScore = (articleA, articleB) => {
        let score = 0;
        if (articleA.tags && articleB.tags) {
            const commonTags = articleA.tags.filter(tag => articleB.tags.includes(tag));
            score += commonTags.length * 5;
        }
        if (articleA.category === articleB.category) {
            score += 2;
        }
        return score;
    };

    return allArticles
        .filter(article => article.id !== articleId)
        .map(article => ({
            ...article,
            score: calculateScore(currentArticle, article)
        }))
        .filter(article => article.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(b.date) - new Date(a.date);
        })
        .slice(0, limit);
}

async function getSingleArticleById(articleId, includeUnpublished = false) {
    if (!memoryCache.isLoaded) await initializeContent();

    const article = memoryCache.articles.find(a => a.id === articleId);
    if (!article) return null;
    if (!includeUnpublished && (article.status === 'Unpublished' || article.status === 'Scheduled')) return null;

    const db = await initializeDatabase();
    const row = await db.get('SELECT content FROM article_files WHERE article_id = ?', articleId);
    if (!row) return null;

    const parsed = parseArticleContent(row.content, articleId);
    const { searchableText, ...cleanArticle } = article;
    return { ...cleanArticle, content: parsed.content };
}

function invalidateCache() {
    // No-op
}

module.exports = {
    initializeContent,
    getCombinedData,
    getPublicSummaries,
    getSingleArticleById,
    searchArticles,
    getRecommendations,
    invalidateCache,
    saveArticleFile,
    deleteArticleFile,
    updateArticleStatus,
    updateArticleFeatured,
    reloadContent,
    stringifyArticle,
    smartQuotes,
    smartQuotesMarkdown
};
