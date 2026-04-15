import { getArticleRecommendations, getSingleArticle, likeArticle, bookmarkArticle, getComments, postComment, editComment, deleteComment, trackArticleView, getAdminFullArticle } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { SocialShare } from '../components/common/SocialShare.js';
import { SmallCard } from '../components/cards/SmallCard.js';
import { AvatarStack } from '../components/metadata/Authors.js';
import { getIsLoggedIn, getCurrentUser, checkLoginStatus } from '../lib/auth.js';
import { showError, showSuccess, showWarning } from '../lib/toast.js';
import { Avatar } from '../components/common/Avatar.js';
import { renderList } from '../lib/template.js';
import { showConfetti } from '../lib/effects.js';
import { render as renderNotFound } from './notFound.js';
import { toRootRelativePath } from '../lib/paths.js';

// Icon asset references
const actionIcons = {
    edit: `<img src="/assets/icons/edit-icon.svg" alt="" aria-hidden="true">`,
    trash: `<img src="/assets/icons/trash-icon.svg" alt="" aria-hidden="true">`
};

let scrollListener = null;

function handleScrollPositioning(articleId) {
    const storageKey = `scrollPos-${articleId}`;
    const savedPosition = sessionStorage.getItem(storageKey);
    if (savedPosition) {
        setTimeout(() => {
            window.scrollTo(0, parseInt(savedPosition, 10));
        }, 10);
        sessionStorage.removeItem(storageKey);
    }
    if (scrollListener) {
        window.removeEventListener('beforeunload', scrollListener);
    }
    scrollListener = () => {
        if (window.scrollY > 200) {
            sessionStorage.setItem(storageKey, window.scrollY.toString());
        }
    };
    window.addEventListener('beforeunload', scrollListener);
}

function MoreLikeThisSection(recommendedArticles) {
    if (!recommendedArticles || recommendedArticles.length === 0) {
        return '';
    }

    const articleCards = renderList(recommendedArticles, SmallCard);

    return `
        <section class="more-like-this-section">
            <h2>More Like This</h2>
            <div class="article-grid">
                ${articleCards}
            </div>
        </section>
    `;
}

function formatTimeAgo(dateString) {
    let date;
    if (dateString.includes('T')) {
        date = new Date(dateString);
    } else if (dateString.includes(' ')) {
        date = new Date(dateString.replace(' ', 'T') + 'Z');
    } else {
        date = new Date(dateString);
    }

    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return date.toLocaleDateString();
}

function createAuthorLineHTML(writers) {
    if (!writers || writers.length === 0) return '';

    const irregularPlurals = { 'Editor-in-Chief': 'Editors-in-Chief' };
    const irregularSingulars = Object.fromEntries(Object.entries(irregularPlurals).map(([s, p]) => [p, s]));

    function normalizeRole(role, count) {
        if (!role || role === 'undefined') return '';
        if (count === 1) {
            if (irregularSingulars[role]) return irregularSingulars[role];
            if (role.endsWith('s') && !role.endsWith('ss') && !['arts', 'sports'].includes(role.toLowerCase())) {
                return role.slice(0, -1);
            }
            return role;
        } else {
            if (irregularPlurals[role]) return irregularPlurals[role];
            if (!role.endsWith('s')) return `${role}s`;
            return role;
        }
    }

    const formatNames = (writers) => {
        const linkedNames = writers.map(w => `<a href="${w.authorLink || `/author/${encodeURIComponent(w.name)}`}" class="author-link">${w.name}</a>`);
        if (linkedNames.length === 1) return linkedNames[0];
        if (linkedNames.length === 2) return linkedNames.join(' and ');
        return `${linkedNames.slice(0, -1).join(', ')}, and ${linkedNames.slice(-1)}`;
    };

    const grouped = writers.reduce((acc, writer) => {
        const rawRole = (!writer.role || writer.role === 'undefined') ? '_noRole' : writer.role;
        const baseRole = rawRole === '_noRole' ? '_noRole' : normalizeRole(rawRole, 1);

        if (!acc[baseRole]) acc[baseRole] = [];
        acc[baseRole].push(writer);
        return acc;
    }, {});

    const parts = Object.entries(grouped).map(([baseRole, group]) => {
        const names = formatNames(group);

        if (baseRole === '_noRole') return names;

        const displayRole = normalizeRole(baseRole, group.length);

        return displayRole ? `${names} • <span class="author-role">${displayRole}</span>` : names;
    });

    let final;
    if (parts.length === 1) final = parts[0];
    else if (parts.length === 2) final = parts.join(' and ');
    else final = `${parts.slice(0, -1).join(', ')}, and ${parts.slice(-1)}`;

    return `By ${final}`;
}

export function createInlineImageFigure(image) { 
    const hasCaption = image.caption || image.credit; 
    const basePlacement = image.placement.replace(/\s+\d+$/, '').toLowerCase().replace(/\s+/g, '-');
    const placementClass = `placement--${basePlacement}`; 
    let figureHTML = `<figure class="single-article-figure ${placementClass}"><img src="${toRootRelativePath(image.file)}" alt="${image.caption || 'Article image'}" class="single-article-image">`; 
    if (hasCaption) { 
        figureHTML += `<figcaption>${image.caption ? `<span class="caption-text">${image.caption}</span>` : ''}${image.credit ? `<span class="caption-credit">${image.credit}</span>` : ''}</figcaption>`; 
    } 
    figureHTML += `</figure>`; 
    return figureHTML; 
}

function processEmbedCode(raw, width, height) {
    let html = (raw || '').trim();
    if (!html) return '';
    const isUrl = /^https?:\/\//i.test(html);
    if (isUrl) {
        let src = html;
        const ytMatch = html.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
        if (ytMatch) src = `https://www.youtube.com/embed/${ytMatch[1]}`;
        const spMatch = html.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/i);
        if (spMatch) src = `https://open.spotify.com/embed/${spMatch[1]}/${spMatch[2]}`;
        html = `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    } else if (html.includes('<iframe')) {
        html = html.replace(/height=["']?\d+["']?/i, `height="${height}"`);
        if (!html.includes('width=')) {
            html = html.replace('<iframe', `<iframe width="${width}"`);
        } else {
            html = html.replace(/width=["']?[^"'\s]+["']?/i, `width="${width}"`);
        }
    }
    return html;
}

export function createInlineEmbedFigure(embed) {
    const basePlacement = embed.placement.replace(/\s+\d+$/, '').toLowerCase().replace(/\s+/g, '-');
    const placementClass = `placement--${basePlacement}`;
    const width = embed.width || '100%';
    const height = parseInt(embed.height, 10) || 560;
    const innerHtml = processEmbedCode(embed.code, width, height);
    if (!innerHtml) return '';
    return `<figure class="single-article-figure single-article-embed-figure ${placementClass}"><div class="embed-container" style="height:${height}px;">${innerHtml}</div></figure>`;
}

function getGalleryLayouts(n) {
    if (n === 1) return [[1]];
    if (n === 2) return [[2], [1, 1]];
    if (n === 3) return [[3], [1, 2], [2, 1]];
    if (n === 4) return [[2, 2], [1, 3], [4]];
    if (n === 5) return [[2, 3], [3, 2], [1, 4]];
    if (n === 6) return [[3, 3], [2, 4], [2, 2, 2]];
    if (n === 7) return [[3, 4], [4, 3], [1, 3, 3]];
    if (n === 8) return [[4, 4], [3, 2, 3], [2, 4, 2]];
    if (n === 9) return [[3, 3, 3], [4, 1, 4], [2, 3, 4]];
    if (n === 10) return [[3, 4, 3], [4, 2, 4], [2, 3, 3, 2]];

    const l1 = [], l2 = [], l3 = [1];
    let rem1 = n;
    while(rem1 > 0) {
        if (rem1 % 3 === 0) { l1.push(3); rem1 -= 3; }
        else if (rem1 % 4 === 0) { l1.push(4); rem1 -= 4; }
        else if (rem1 > 4) { l1.push(3); rem1 -= 3; }
        else { l1.push(rem1); rem1 = 0; }
    }
    let rem2 = n;
    while(rem2 > 0) {
        if (rem2 % 4 === 0) { l2.push(4); rem2 -= 4; }
        else if (rem2 > 4) { l2.push(4); rem2 -= 4; }
        else { l2.push(rem2); rem2 = 0; }
    }
    let rem3 = n - 1;
    while(rem3 > 0) {
        if (rem3 % 3 === 0) { l3.push(3); rem3 -= 3; }
        else if (rem3 % 4 === 0) { l3.push(4); rem3 -= 4; }
        else if (rem3 > 4) { l3.push(3); rem3 -= 3; }
        else { l3.push(rem3); rem3 = 0; }
    }
    return [l1, l2, l3];
}

function getRatioForSpan(span) {
    if (span === 12) return '21/9';
    if (span === 6) return '4/3';
    if (span === 4) return '1/1';
    if (span === 3) return '4/5';
    return '1/1';
}

export function renderGalleryHTML(imgs) {
    const validImgs = (imgs || []).filter(img => (img.file || '').trim());
    if (validImgs.length === 0) return '';
    const count = validImgs.length;

    // Calculate logical span divisions dynamically for perfect justification
    const layouts = getGalleryLayouts(count);
    const layoutSpans = layouts.map(rowConfig => {
        const spans = [];
        rowConfig.forEach(numItems => {
            const span = 12 / numItems;
            for(let i=0; i<numItems; i++) spans.push(span);
        });
        return spans;
    });

    const initialSpans = layoutSpans[0];

    // Check if exactly one image has a caption/credit -> treat as Global Caption
    const imagesWithText = validImgs.filter(img => img.caption || img.credit);
    const isGlobalCaption = imagesWithText.length === 1;

    const items = validImgs.map((img, idx) => {
        const src = toRootRelativePath(img.file);
        const alt = img.alt || img.caption || 'Gallery photo';
        const caption = img.caption || '';
        const credit = img.credit || '';
        const hasCaption = caption || credit;

        // Show per-image text only if it isn't being used as the global gallery caption
        const showItemText = hasCaption && !isGlobalCaption;

        const deskSpan = initialSpans[idx];
        const deskRatio = getRatioForSpan(deskSpan);

        let mobSpan = 1;
        let mobRatio = '1/1';
        if (count % 2 !== 0 && idx === 0) {
            mobSpan = 2; // Full width for odd first items on mobile
            mobRatio = '16/9';
        }

        const style = `--desk-span: ${deskSpan}; --desk-ratio: ${deskRatio}; --mob-span: ${mobSpan}; --mob-ratio: ${mobRatio};`;

        return `<div class="photo-gallery-item" style="${style}">
            <div class="photo-gallery-thumb">
                <img src="${src}" alt="${alt}" loading="lazy">
                ${showItemText ? `<div class="photo-gallery-overlay">${caption ? `<p class="overlay-caption">${caption}</p>` : ''}${credit ? `<p class="overlay-credit">${credit}</p>` : ''}</div>` : ''}
            </div>
            ${showItemText ? `<figcaption class="photo-gallery-cap">${caption ? `<span class="cap-text">${caption}</span>` : ''}${credit ? `<span class="cap-credit">${credit}</span>` : ''}</figcaption>` : ''}
        </div>`;
    }).join('');

    let globalCaptionHTML = '';
    if (isGlobalCaption) {
        const globalImg = imagesWithText[0];
        const caption = globalImg.caption || '';
        const credit = globalImg.credit || '';
        globalCaptionHTML = `<figcaption class="photo-gallery-global-cap">
            ${caption ? `<span class="caption-text">${caption}</span>` : ''}
            ${credit ? `<span class="caption-credit">${credit}</span>` : ''}
        </figcaption>`;
    }

    const toggleIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`;

    const toggleBtn = count > 1 ?
        `<button type="button" class="gallery-layout-toggle" data-spans='${JSON.stringify(layoutSpans)}' aria-label="Toggle layout" title="Change gallery layout">
            ${toggleIcon}
        </button>` : '';

    return `<figure class="photo-gallery photo-gallery--count-${count}" data-count="${count}" data-layout="0" aria-label="Photo gallery">
        ${toggleBtn}
        <div class="photo-gallery-grid">${items}</div>
        ${globalCaptionHTML}
    </figure>`;
}

export function setupGalleryLightbox(container) {
    const galleries = container.querySelectorAll('.photo-gallery');
    const inlineFigures = container.querySelectorAll('.single-article-figure');

    if (!galleries.length && !inlineFigures.length) return;

    // Setup gallery layout toggle buttons
    galleries.forEach(gallery => {
        const toggleBtn = gallery.querySelector('.gallery-layout-toggle');
        const items = gallery.querySelectorAll('.photo-gallery-item');

        if (toggleBtn && items.length > 0) {
            const spansData = JSON.parse(toggleBtn.dataset.spans);
            const maxLayouts = spansData.length;

            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                let currentLayout = parseInt(gallery.dataset.layout || '0', 10);
                let nextLayout = (currentLayout + 1) % maxLayouts;

                const spans = spansData[nextLayout];
                items.forEach((item, idx) => {
                    const span = spans[idx];
                    let ratio = '1/1';
                    if (span === 12) ratio = '21/9';
                    else if (span === 6) ratio = '4/3';
                    else if (span === 4) ratio = '1/1';
                    else if (span === 3) ratio = '4/5';

                    item.style.setProperty('--desk-span', span);
                    item.style.setProperty('--desk-ratio', ratio);
                });

                gallery.dataset.layout = nextLayout;
            });
        }
    });

    // Pre-compute per-gallery caption info (global vs per-image)
    const galleryCapInfo = new Map();
    galleries.forEach(gallery => {
        const isGlobalCaption = !!gallery.querySelector('.photo-gallery-global-cap');
        let globalCapText = '';
        let globalCreditText = '';
        if (isGlobalCaption) {
            const globalCapEl = gallery.querySelector('.photo-gallery-global-cap .caption-text');
            const globalCredEl = gallery.querySelector('.photo-gallery-global-cap .caption-credit');
            globalCapText = globalCapEl ? globalCapEl.textContent : '';
            globalCreditText = globalCredEl ? globalCredEl.textContent : '';
        }
        galleryCapInfo.set(gallery, { isGlobalCaption, globalCapText, globalCreditText });
    });

    // Collect all clickable image elements in DOM order (.photo-gallery-item and .single-article-figure)
    const allImages = [];
    const elementIndexMap = new WeakMap();

    container.querySelectorAll('.photo-gallery-item, .single-article-figure').forEach(item => {
        if (item.classList.contains('photo-gallery-item')) {
            const img = item.querySelector('img');
            if (!img || !img.src) return;

            const gallery = item.closest('.photo-gallery');
            const capInfo = gallery ? galleryCapInfo.get(gallery) : null;
            const cap = item.querySelector('.cap-text');
            const cred = item.querySelector('.cap-credit');

            elementIndexMap.set(item, allImages.length);
            allImages.push({
                src: img.src,
                alt: img.alt || '',
                caption: capInfo?.isGlobalCaption ? capInfo.globalCapText : (cap ? cap.textContent : ''),
                credit: capInfo?.isGlobalCaption ? capInfo.globalCreditText : (cred ? cred.textContent : ''),
            });
        } else if (item.classList.contains('single-article-figure')) {
            const img = item.querySelector('img');
            if (!img || !img.src) return;

            const capEl = item.querySelector('figcaption .caption-text');
            const credEl = item.querySelector('figcaption .caption-credit');

            elementIndexMap.set(item, allImages.length);
            allImages.push({
                src: img.src,
                alt: img.alt || '',
                caption: capEl ? capEl.textContent : '',
                credit: credEl ? credEl.textContent : '',
            });
        }
    });

    if (!allImages.length) return;

    let lb = document.getElementById('gallery-lightbox');
    if (lb) lb.remove();
    lb = document.createElement('div');
    lb.id = 'gallery-lightbox';
    lb.className = 'gallery-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Image viewer');
    lb.innerHTML = `
        <button class="lb-close" aria-label="Close"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        <button class="lb-prev" aria-label="Previous"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
        <button class="lb-next" aria-label="Next"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
        <div class="lb-stage">
            <img class="lb-img" src="" alt="">
            <div class="lb-caption-wrap"><p class="lb-caption-text"></p><span class="lb-caption-credit"></span></div>
        </div>`;
    document.body.appendChild(lb);

    let currentIndex = -1;

    function openLightbox(index) {
        currentIndex = ((index % allImages.length) + allImages.length) % allImages.length;
        const d = allImages[currentIndex];
        lb.querySelector('.lb-img').src = d.src;
        lb.querySelector('.lb-img').alt = d.alt;
        lb.querySelector('.lb-caption-text').textContent = d.caption;
        lb.querySelector('.lb-caption-credit').textContent = d.credit;
        lb.querySelector('.lb-caption-wrap').style.display = (d.caption || d.credit) ? '' : 'none';
        lb.querySelector('.lb-prev').style.display = allImages.length > 1 ? '' : 'none';
        lb.querySelector('.lb-next').style.display = allImages.length > 1 ? '' : 'none';
        lb.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lb.classList.remove('active');
        document.body.style.overflow = '';
    }

    lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
    lb.querySelector('.lb-prev').addEventListener('click', e => { e.stopPropagation(); openLightbox(currentIndex - 1); });
    lb.querySelector('.lb-next').addEventListener('click', e => { e.stopPropagation(); openLightbox(currentIndex + 1); });
    lb.addEventListener('click', e => { if (!e.target.closest('.lb-img, .lb-caption-wrap, .lb-close, .lb-prev, .lb-next')) closeLightbox(); });

    // Wire up click handlers for all items in DOM order
    container.querySelectorAll('.photo-gallery-item, .single-article-figure').forEach(item => {
        if (!elementIndexMap.has(item)) return;
        const idx = elementIndexMap.get(item);
        item.style.cursor = 'pointer';
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `View image ${idx + 1} of ${allImages.length}`);
        item.addEventListener('click', () => openLightbox(idx));
        item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(idx); } });
    });

    document.addEventListener('keydown', e => {
        if (!lb.classList.contains('active')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') openLightbox(currentIndex - 1);
        if (e.key === 'ArrowRight') openLightbox(currentIndex + 1);
    });
}

export function injectImagesIntoContent(content, mediaItems) {
    const safeContent = content || '';
    const allMedia = mediaItems || [];

    const galleryImages = allMedia.filter(item => item.type !== 'embed' && item.placement && item.placement.startsWith('Gallery'));
    const regularMedia = allMedia.filter(item => item.type === 'embed' || !item.placement || !item.placement.startsWith('Gallery'));

    if (regularMedia.length === 0 && galleryImages.length === 0) {
        return { mainContent: safeContent, bottomContent: '' };
    }

    const sanitizedContent = DOMPurify.sanitize(safeContent, { USE_PROFILES: { html: true }, ADD_TAGS: ['iframe'], ADD_ATTR: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'scrolling', 'title', 'loading', 'sandbox', 'allow'] });
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitizedContent, 'text/html');
    doc.body.querySelectorAll('img[src]').forEach(img => {
        img.setAttribute('src', toRootRelativePath(img.getAttribute('src')));
    });
    let contentElements = Array.from(doc.body.children);

    const createImageFigureNode = (image) => {
        const figureHtml = createInlineImageFigure(image);
        const doc = parser.parseFromString(DOMPurify.sanitize(figureHtml), 'text/html');
        return doc.body.firstChild;
    };

    const createEmbedFigureNode = (embed) => {
        const figureHtml = createInlineEmbedFigure(embed);
        if (!figureHtml) return null;
        const d = parser.parseFromString(DOMPurify.sanitize(figureHtml, { USE_PROFILES: { html: true }, ADD_TAGS: ['iframe'], ADD_ATTR: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'allow', 'style'] }), 'text/html');
        return d.body.firstChild;
    };

    const createMediaFigureNode = (item) => item.type === 'embed' ? createEmbedFigureNode(item) : createImageFigureNode(item);

    const parseGalleryNode = (imgs) => {
        const html = renderGalleryHTML(imgs);
        if (!html) return null;
        const d = parser.parseFromString(html, 'text/html');
        return d.body.firstChild;
    };

    const topMedia = regularMedia.filter(item => item.placement && item.placement.startsWith('Top'));
    const bottomCenterMedia = regularMedia.filter(item => item.placement === 'Bottom Center');
    const bottomFloatMedia = regularMedia.filter(item => ['Bottom Left', 'Bottom Right'].includes(item.placement));
    const customMedia = regularMedia.filter(item => item.placement && item.placement.startsWith('Custom'));

    // Group gallery images by exact placement value (e.g. "Gallery Top", "Gallery Custom 3")
    const galleryGroups = new Map();
    galleryImages.forEach(img => {
        const pos = img.placement;
        if (!galleryGroups.has(pos)) galleryGroups.set(pos, []);
        galleryGroups.get(pos).push(img);
    });

    // Count every block of text as a paragraph, regardless of tag.
    const BLOCK_TAGS = new Set([
        'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'BLOCKQUOTE', 'PRE', 'DIV',
        'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
        'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL',
        'FIGURE', 'FIGCAPTION',
        'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'NAV', 'HEADER', 'FOOTER', 'ADDRESS',
        'DETAILS', 'SUMMARY', 'DIALOG',
        'FIELDSET', 'LEGEND', 'FORM',
        'CANVAS', 'HR', 'NOSCRIPT',
        'PICTURE', 'VIDEO', 'AUDIO',
        'IFRAME', 'EMBED', 'OBJECT',
        'METER', 'PROGRESS', 'OUTPUT',
        'TEMPLATE',
    ]);
    const getParagraphs = () => contentElements.filter(el => {
        if (!BLOCK_TAGS.has(el.tagName)) return false;
        return el.textContent.trim().length > 0 || el.tagName === 'DIV' || el.tagName === 'TABLE';
    });

    // 1. Inject Custom Media (Images + Embeds targeting specific paragraphs)
    customMedia.forEach(item => {
        const match = item.placement.match(/Custom (Left|Center|Right)(?: (\d+))?/i);
        const align = match ? match[1] : 'Center';
        const pIndex = match && match[2] ? parseInt(match[2], 10) - 1 : 0;

        const paragraphs = getParagraphs();
        const targetP = paragraphs[Math.min(Math.max(pIndex, 0), paragraphs.length > 0 ? paragraphs.length - 1 : 0)];

        const figureNode = createMediaFigureNode(item);
        if (!figureNode) return;

        if (targetP) {
            const elIndex = contentElements.indexOf(targetP);
            if (align === 'Center') {
                contentElements.splice(elIndex + 1, 0, figureNode);
            } else {
                contentElements.splice(elIndex, 0, figureNode);
            }
        } else {
            contentElements.push(figureNode);
        }
    });

    // 2. Inject Gallery Custom (after paragraph N)
    galleryGroups.forEach((imgs, pos) => {
        if (!pos.startsWith('Gallery Custom')) return;
        const match = pos.match(/Gallery Custom\s+(\d+)/i);
        const pIndex = match ? parseInt(match[1], 10) - 1 : 0;

        const paragraphs = getParagraphs();
        const targetP = paragraphs[Math.min(Math.max(pIndex, 0), paragraphs.length > 0 ? paragraphs.length - 1 : 0)];

        const galleryNode = parseGalleryNode(imgs);
        if (!galleryNode) return;

        if (targetP) {
            const elIndex = contentElements.indexOf(targetP);
            contentElements.splice(elIndex + 1, 0, galleryNode);
        } else {
            contentElements.push(galleryNode);
        }
    });

    // 3. Inject Bottom Float Images
    if (bottomFloatMedia.length > 0) {
        const paragraphs = getParagraphs();
        const lastP = paragraphs[paragraphs.length - 1];
        for (let i = bottomFloatMedia.length - 1; i >= 0; i--) {
            const figureNode = createMediaFigureNode(bottomFloatMedia[i]);
            if (figureNode) {
                if (lastP) {
                    const elIndex = contentElements.indexOf(lastP);
                    contentElements.splice(elIndex, 0, figureNode);
                } else {
                    contentElements.push(figureNode);
                }
            }
        }
    }

    const topMediaHTML = topMedia.map(item => {
        const node = createMediaFigureNode(item);
        return node ? node.outerHTML : '';
    }).join('');

    const galleryTopHTML = galleryGroups.has('Gallery Top') ? renderGalleryHTML(galleryGroups.get('Gallery Top')) : '';
    const galleryBottomHTML = galleryGroups.has('Gallery Bottom') ? renderGalleryHTML(galleryGroups.get('Gallery Bottom')) : '';

    const mainContentHTML = galleryTopHTML + topMediaHTML + contentElements.map(el => el.outerHTML).join('');
    const bottomContentHTML = bottomCenterMedia.map(item => {
        const node = createMediaFigureNode(item);
        return node ? node.outerHTML : '';
    }).join('') + galleryBottomHTML;

    return { mainContent: mainContentHTML, bottomContent: bottomContentHTML };
}

function Comment(comment) {
    const isLoggedIn = getIsLoggedIn();
    const currentUser = getCurrentUser();
    const isAuthor = isLoggedIn && currentUser && currentUser.user_id === comment.author_id;
    const isAdmin = isLoggedIn && currentUser && currentUser.is_admin;
    const canModerate = isAuthor || isAdmin;

    const li = document.createElement('li');
    li.id = `comment-${comment.comment_id}`;
    li.dataset.timestamp = comment.timestamp;

    const commentDiv = document.createElement('div');
    commentDiv.className = 'comment';

    const commentAvatarHTML = Avatar({
        userId: comment.author_id,
        username: comment.author_name || 'Anonymous',
        customAvatar: comment.custom_avatar,
        size: 'medium',
        className: 'comment-avatar',
        isAdmin: comment.author_is_admin || false
    });
    const parser = new DOMParser();
    const avatarNode = parser.parseFromString(DOMPurify.sanitize(commentAvatarHTML), 'text/html').body.firstChild;
    if (avatarNode) {
        commentDiv.appendChild(avatarNode);
    }

    const commentMain = document.createElement('div');
    commentMain.className = 'comment-main';

    const commentHeader = document.createElement('div');
    commentHeader.className = 'comment-header';

    const headerLeft = document.createElement('div');
    const authorSpan = document.createElement('span');
    authorSpan.className = 'comment-author';
    authorSpan.textContent = comment.author_name;
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'comment-timestamp';
    const timeText = formatTimeAgo(comment.timestamp);
    const editedText = comment.edited_at ? ' (edited)' : '';
    timestampSpan.textContent = ' • ' + timeText + editedText;
    headerLeft.appendChild(authorSpan);
    headerLeft.appendChild(timestampSpan);
    commentHeader.appendChild(headerLeft);

    if (canModerate) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'comment-actions';
        actionsDiv.innerHTML = DOMPurify.sanitize(`
            <button class="button-icon-only comment-edit-btn" data-comment-id="${comment.comment_id}" title="Edit comment">
                ${actionIcons.edit}
            </button>
            <button class="button-icon-only delete comment-delete-btn" data-comment-id="${comment.comment_id}" title="Delete comment">
                ${actionIcons.trash}
            </button>
        `);
        commentHeader.appendChild(actionsDiv);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'comment-content';
    contentDiv.id = `comment-content-${comment.comment_id}`;
    contentDiv.textContent = comment.content;

    const editFormId = `edit-textarea-${comment.comment_id}`;
    const editForm = document.createElement('div');
    editForm.className = 'comment-edit-form';
    editForm.id = `comment-edit-form-${comment.comment_id}`;
    editForm.style.display = 'none';
    editForm.innerHTML = DOMPurify.sanitize(`
        <label for="${editFormId}" class="sr-only">Edit your comment</label>
        <textarea class="comment-edit-textarea" id="${editFormId}" name="${editFormId}"></textarea>
        <div class="comment-edit-actions">
            <button class="button-secondary cancel-btn" data-comment-id="${comment.comment_id}">Cancel</button>
            <button class="button-primary save-btn" data-comment-id="${comment.comment_id}">Save Changes</button>
        </div>
    `);
    editForm.querySelector('textarea').textContent = comment.content;

    commentMain.appendChild(commentHeader);
    commentMain.appendChild(contentDiv);
    commentMain.appendChild(editForm);
    commentDiv.appendChild(commentMain);
    li.appendChild(commentDiv);

    return li;
}

function CommentSection(articleId, commentsDisabled = false) {
    const isLoggedIn = getIsLoggedIn();
    const currentUser = getCurrentUser();

    const commentFormHTML = commentsDisabled ? `
        <div class="login-prompt-for-comments">
            <p>Comments are closed for this article.</p>
        </div>
    ` : isLoggedIn && currentUser ? `
        <form class="comment-form" id="comment-form" data-article-id="${articleId}">
            ${Avatar({
                userId: currentUser.user_id,
                username: currentUser.username,
                customAvatar: currentUser.custom_avatar,
                size: 'medium',
                className: 'comment-form-avatar',
                isAdmin: currentUser.is_admin || false
            })}
            <div class="comment-form-main">
                <textarea id="comment-content" placeholder="Write a comment as ${currentUser.username}..." required maxlength="500"></textarea>
                <div class="comment-form-actions">
                    <span class="char-counter" id="char-counter">500</span>
                    <button type="submit" id="comment-submit-btn" class="button-primary" disabled>Post Comment</button>
                </div>
            </div>
        </form>
    ` : `
        <div class="login-prompt-for-comments">
            <p><a href="/login" onclick="sessionStorage.setItem('returnToAfterAuth', location.pathname)">Log in</a> or <a href="/signup" onclick="sessionStorage.setItem('returnToAfterAuth', location.pathname)">sign up</a> to leave a comment.</p>
        </div>
    `;

    return `
        <section class="comments-section">
            <div class="comments-header">
                <h3>Comments</h3>
                <span class="comment-count" id="comment-count-display"></span>
            </div>
            ${commentFormHTML}
            <ul id="comment-list"></ul>
        </section>
    `;
}

function createHTML(article, recommendedArticles) {
    const { writers, tags, category, date, title, description, content, images, embeds = [], id } = article;
    const tagListHTML = (tags && tags.length > 0) ? `<div class="tag-list">${tags.map(tag => `<a href="/search/${encodeURIComponent(tag)}" class="tag-item">${tag}</a>`).join('')}</div>` : '';
    const singleArticleMaxVisible = writers && writers.length >= 4 ? 2 : null;
    const authorMetaTopHTML = (writers && writers.length > 0) ? `<div class="single-article-meta-top">${AvatarStack(writers, { compact: false, maxVisible: singleArticleMaxVisible })}<span class="author-byline">${createAuthorLineHTML(writers)}</span></div>` : '';
    let authorBiosContainer = '';
    const currentStaffForBio = writers.filter(w => w.isCurrentStaff && w.bio);
    if (currentStaffForBio.length > 0) {
        const authorProfilesHTML = currentStaffForBio.map(writer => `<div class="author-profile"><img src="${toRootRelativePath(writer.image)}" alt="${writer.name}"><div><h4>About ${writer.name}</h4><p>${writer.bio}</p></div></div>`).join('<hr class="author-separator">');
        authorBiosContainer = `<div class="author-bios-container">${authorProfilesHTML}</div>`;
    }
    const mediaItems = [
        ...(images || []).map(img => ({ ...img, type: 'image' })),
        ...(embeds || []).map(emb => ({ ...emb, type: 'embed' }))
    ];
    const { mainContent, bottomContent } = injectImagesIntoContent(content, mediaItems);
    const likedClass = article.user_has_liked ? 'liked' : '';
    const bookmarkedClass = article.user_has_bookmarked ? 'bookmarked' : '';
    const moreLikeThisHTML = MoreLikeThisSection(recommendedArticles);

    const currentUser = getCurrentUser();
    const isAdmin = currentUser && currentUser.is_admin;
    const adminBarHTML = isAdmin ? `
        <div class="article-admin-bar">
            <span class="article-admin-bar__label">Admin</span>
            <a href="/admin/edit/${id}" class="article-admin-bar__edit-btn">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit Article
            </a>
        </div>
    ` : '';

    return `
        <section class="page" id="single-article-page">
            <div class="container">
                <div class="single-article-wrapper">
                    ${adminBarHTML}
                    <div class="article-meta-bar"><span class="category">${category}</span><span class="date">${date}</span></div>
                    <header class="single-article-header">
                        <h1>${title}</h1>
                        <p class="single-article-description">${description}</p>
                        <div class="article-interactions">
                            <button class="interaction-btn like-btn ${likedClass}" data-article-id="${id}">👍 <span class="like-count">${article.likes}</span> <span class="like-text">${article.likes === 1 ? 'Like' : 'Likes'}</span></button>
                            <button class="interaction-btn comment-scroll-btn" id="comment-scroll-btn">💬 <span id="top-comment-count">0</span> <span id="top-comment-text">Comments</span></button>
                            <button class="interaction-btn bookmark-btn ${bookmarkedClass}" data-article-id="${id}">🔖 <span class="bookmark-text">${article.user_has_bookmarked ? 'Bookmarked' : 'Bookmark'}</span></button>
                        </div>
                        ${SocialShare(article, { variant: 'minimal' })}
                    </header>
                    ${tagListHTML}
                    ${authorMetaTopHTML}
                    <div class="single-article-content">
                        ${mainContent}
                        ${bottomContent}
                        ${SocialShare(article, { variant: 'full' })}
                        ${authorBiosContainer}
                        ${moreLikeThisHTML}
                        ${CommentSection(id, article.comments_disabled)}
                    </div>
                </div>
            </div>
        </section>
    `;
}

function updateCommentCount(count) {
    const displayHeader = document.getElementById('comment-count-display');
    const displayTopBtn = document.getElementById('top-comment-count');
    const textTopBtn = document.getElementById('top-comment-text');

    if (displayHeader) {
        if (count === 0) {
            displayHeader.textContent = '';
        } else {
            displayHeader.textContent = `(${count})`;
        }
    }
    if (displayTopBtn && textTopBtn) {
        displayTopBtn.textContent = count;
        textTopBtn.textContent = count === 1 ? 'Comment' : 'Comments';
    }
}

function attachCommentFormListeners() {
    const form = document.getElementById('comment-form');
    if (!form) return;

    const articleId = form.dataset.articleId;
    const contentInput = document.getElementById('comment-content');
    const submitBtn = document.getElementById('comment-submit-btn');
    const charCounter = document.getElementById('char-counter');
    const commentList = document.getElementById('comment-list');
    const MAX_CHARS = 500;

    function validateForm() {
        submitBtn.disabled = !(contentInput.value.trim().length > 0);
    }

    contentInput.addEventListener('input', () => {
        validateForm();
        const remaining = MAX_CHARS - contentInput.value.length;
        charCounter.textContent = remaining;
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = 'Posting...';

        const newCommentData = await postComment(articleId, contentInput.value.trim());

        if (newCommentData && !newCommentData.error) {
            const newCommentElement = Comment(newCommentData);
            commentList.prepend(newCommentElement);

            const currentCount = (commentList.children.length);
            updateCommentCount(currentCount);
            contentInput.value = '';
            charCounter.textContent = MAX_CHARS;
            showSuccess('Comment posted successfully!');
            showConfetti();
        } else {
            showError(newCommentData?.error || 'Failed to post comment. You may need to log in again.');
        }
        submitBtn.textContent = 'Post Comment';
        validateForm();
    });
}

async function loadComments(articleId) {
    const commentList = document.getElementById('comment-list');
    if (!commentList) return;

    const comments = await getComments(articleId);
    commentList.innerHTML = '';
    comments.forEach(comment => {
        const commentElement = Comment(comment);
        commentList.appendChild(commentElement);
    });
    updateCommentCount(comments.length);

    attachCommentActionListeners();
}

function attachCommentActionListeners() {
    const commentList = document.getElementById('comment-list');
    if (!commentList) return;

    commentList.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.comment-edit-btn');
        if (editBtn) {
            const commentId = editBtn.dataset.commentId;
            showEditForm(commentId);
            return;
        }
        const deleteBtn = e.target.closest('.comment-delete-btn');
        if (deleteBtn) {
            const commentId = deleteBtn.dataset.commentId;
            if (confirm('Are you sure you want to delete this comment?')) {
                await handleDeleteComment(commentId);
            }
            return;
        }
        const saveBtn = e.target.closest('.save-btn');
        if (saveBtn) {
            const commentId = saveBtn.dataset.commentId;
            await handleSaveComment(commentId);
            return;
        }
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const commentId = cancelBtn.dataset.commentId;
            hideEditForm(commentId);
            return;
        }
    });
}

function showEditForm(commentId) {
    const commentMain = document.querySelector(`#comment-${commentId} .comment-main`);
    commentMain.querySelector('.comment-content').style.display = 'none';
    commentMain.querySelector('.comment-header .comment-actions').style.visibility = 'hidden';
    commentMain.querySelector('.comment-edit-form').style.display = 'block';
}

function hideEditForm(commentId) {
    const commentMain = document.querySelector(`#comment-${commentId} .comment-main`);
    commentMain.querySelector('.comment-content').style.display = 'block';
    const actions = commentMain.querySelector('.comment-header .comment-actions');
    if(actions) actions.style.visibility = 'visible';
    commentMain.querySelector('.comment-edit-form').style.display = 'none';
}

async function handleSaveComment(commentId) {
    const editForm = document.getElementById(`comment-edit-form-${commentId}`);
    const textarea = editForm.querySelector('.comment-edit-textarea');
    const newContent = textarea.value.trim();

    if (!newContent) {
        showWarning('Comment cannot be empty.');
        return;
    }

    const updatedComment = await editComment(commentId, newContent);
    if (updatedComment) {
        const contentDiv = document.getElementById(`comment-content-${commentId}`);
        contentDiv.textContent = newContent;

        const commentElement = document.getElementById(`comment-${commentId}`);
        const timestampSpan = commentElement.querySelector('.comment-timestamp');
        if (timestampSpan) {
            const timeText = formatTimeAgo(updatedComment.timestamp);
            timestampSpan.textContent = ' • ' + timeText + ' (edited)';
        }

        hideEditForm(commentId);
        showSuccess('Comment updated successfully!');
    } else {
        showError('Failed to update comment. Please try again.');
    }
}

async function handleDeleteComment(commentId) {
    const result = await deleteComment(commentId);
    if (result) {
        const commentElement = document.getElementById(`comment-${commentId}`);
        commentElement.remove();
        const currentCount = document.getElementById('comment-list').children.length;
        updateCommentCount(currentCount);
        showSuccess('Comment deleted successfully.');
    } else {
        showError('Failed to delete comment. Please try again.');
    }
}

async function renderArticleContent(container, article, recommendedArticles) {
    container.innerHTML = DOMPurify.sanitize(createHTML(article, recommendedArticles), { USE_PROFILES: { html: true }, ADD_TAGS: ['iframe'], ADD_ATTR: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'scrolling', 'title', 'loading', 'sandbox', 'allow'] });

    setupGalleryLightbox(container);
    handleScrollPositioning(article.id);
    attachCommentFormListeners();

    if (getIsLoggedIn()) {
        trackArticleView(article.id);
    }

    const likeBtn = container.querySelector('.like-btn');
    if (likeBtn) {
        likeBtn.addEventListener('click', async () => {
            if (!getIsLoggedIn()) {
                showWarning('Please log in to like articles.');
                sessionStorage.setItem('returnToAfterAuth', location.pathname);
                navigate('/login');
                return;
            }
            const isCurrentlyLiked = likeBtn.classList.contains('liked');
            const result = await likeArticle(article.id, !isCurrentlyLiked);
            if (result) {
                likeBtn.querySelector('.like-count').textContent = result.likes;
                likeBtn.querySelector('.like-text').textContent = result.likes === 1 ? 'Like' : 'Likes';
                likeBtn.classList.toggle('liked', result.user_has_liked);
                if (result.user_has_liked) {
                    showConfetti();
                }
            } else {
                showError('Action failed. Please try again.');
            }
        });
    }

    const bookmarkBtn = container.querySelector('.bookmark-btn');
    if (bookmarkBtn) {
        bookmarkBtn.addEventListener('click', async () => {
            if (!getIsLoggedIn()) {
                showWarning('Please log in to bookmark articles.');
                sessionStorage.setItem('returnToAfterAuth', location.pathname);
                navigate('/login');
                return;
            }
            const isCurrentlyBookmarked = bookmarkBtn.classList.contains('bookmarked');
            const result = await bookmarkArticle(article.id, !isCurrentlyBookmarked);
            if (result) {
                bookmarkBtn.querySelector('.bookmark-text').textContent = result.user_has_bookmarked ? 'Bookmarked' : 'Bookmark';
                bookmarkBtn.classList.toggle('bookmarked', result.user_has_bookmarked);
                showSuccess(result.user_has_bookmarked ? 'Article bookmarked!' : 'Bookmark removed!');
            } else {
                showError('Action failed. Please try again.');
            }
        });
    }

    const commentScrollBtn = container.querySelector('#comment-scroll-btn');
    const commentsSection = container.querySelector('.comments-section');
    if (commentScrollBtn && commentsSection) {
        commentScrollBtn.addEventListener('click', () => {
            commentsSection.scrollIntoView({ behavior: 'smooth' });
        });
    }

    loadComments(article.id);
}

export async function render(container, articleId) {
    // Parallel fetch: Get FULL article content AND server-computed recommendations.
    // Using the dedicated recommendations endpoint avoids downloading the entire
    // article list just to score four suggestions on the client side.
    const [article, recommendedArticles] = await Promise.all([
        getSingleArticle(articleId),
        getArticleRecommendations(articleId)
    ]);
    
    const cleanup = () => {
        if (scrollListener) {
            window.removeEventListener('beforeunload', scrollListener);
            scrollListener = null;
        }
    };

    if (article) {
        await renderArticleContent(container, article, recommendedArticles);
        return cleanup;
    } else {
        // Article not found in public fetch.
        // Check if user is admin and try to fetch unpublished content.
        await checkLoginStatus();
        const currentUser = getCurrentUser();
        const isAdmin = currentUser && currentUser.is_admin;

        if (isAdmin) {
            const adminArticle = await getAdminFullArticle(articleId);
            if (adminArticle) {
                // If found via admin API, show custom 404 with reveal button.
                // Recommendations for unpublished articles return empty from the server.
                renderNotFound(container, adminArticle, (articleData) => {
                    renderArticleContent(container, articleData, recommendedArticles);
                });
                return cleanup;
            }
        }

        cleanup();
        navigate('/404');
    }
}