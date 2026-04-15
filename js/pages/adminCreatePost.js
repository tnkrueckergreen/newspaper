// andoverview/js/pages/adminCreatePost.js
import { createArticle, updateArticle, getAdminFullArticle, getCombinedData, registerEmbedExtension, getServerDraft, saveServerDraft, deleteServerDraft } from '../lib/api.js';
import { showError, showSuccess, showWarning } from '../lib/toast.js';
import { injectImagesIntoContent } from './singleArticle.js';
import { navigate } from '../lib/router.js';

// ─── Smart Quotes ─────────────────────────────────────────────────────────────
function setupSmartQuotes(el) {
    el.addEventListener('keydown', function(e) {
        if (e.key !== '"' && e.key !== "'") return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        const val = this.value;
        const prev = start > 0 ? val[start - 1] : '';
        const next = end < val.length ? val[end] : '';
        let quote;
        if (e.key === '"') {
            quote = (!prev || /[\s\(\[\{]/.test(prev)) ? '\u201C' : '\u201D';
        } else {
            if (/\w/.test(prev) && /\w/.test(next)) {
                quote = '\u2019';
            } else if (!prev || /[\s\(\[\{]/.test(prev)) {
                quote = '\u2018';
            } else {
                quote = '\u2019';
            }
        }
        this.value = val.slice(0, start) + quote + val.slice(end);
        this.selectionStart = this.selectionEnd = start + 1;
        this.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

// ─── State ────────────────────────────────────────────────────────────────────
let initialFormState = null;
let initialFormStateTimer = null;
let autosaveTimer = null;
let currentArticleId = null;
let savedTableModalState = null;

// ─── Icon References ──────────────────────────────────────────────────────────
const icons = {
    trash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    upload: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>`,
    embed: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>`,
    target: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`
};

const icons_svg = {
    enterFs: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
    exitFs:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`,
    split:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/></svg>`,
    find:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`
};

// ─── Staff & Roles ─────────────────────────────────────────────────────────────
let staffList = [];
const commonRoles = [
    "Associate Editor", "Arts Editor", "Co-Editor-in-Chief", "Contributor",
    "Copy Editor", "Correspondent", "Editorial Board", "Editor-in-Chief",
    "Executive Editor", "Faculty Advisor", "Guest Columnist", "Layout Editor",
    "Managing Editor", "Online Editor", "Opinion Editor", "Photographer",
    "Social Media Manager", "Sports Editor", "Staff Writer"
];

async function loadStaffData() {
    try {
        const data = await getCombinedData();
        if (!data) return;
        staffList = data.staff;
        staffList.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
        console.warn('Could not load staff list for autocomplete', e);
    }
}

// ─── Dirty Checking ───────────────────────────────────────────────────────────
function getFormSnapshot() {
    const form = document.getElementById('create-post-form');
    if (!form) return null;
    const formData = new FormData(form);
    const snapshot = {};
    for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
            if (value.name && value.size > 0)
                snapshot[key] = { name: value.name, size: value.size };
        } else {
            if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
                if (!Array.isArray(snapshot[key])) snapshot[key] = [snapshot[key]];
                snapshot[key].push(value);
            } else {
                snapshot[key] = value;
            }
        }
    }
    return JSON.stringify(snapshot);
}

function hasUnsavedChanges() {
    if (!initialFormState) return false;
    const snapshot = getFormSnapshot();
    if (snapshot === null) return false;
    return snapshot !== initialFormState;
}

function updateUnsavedDot() {
    const dot = document.getElementById('unsaved-dot');
    if (dot) dot.classList.toggle('visible', hasUnsavedChanges());
}

// ─── Auto-save & Server Drafts ────────────────────────────────────────────────
function getAutosaveKey(articleId) {
    return `andoverview_autosave_${articleId || 'new'}`;
}

function collectAutosaveData() {
    const getVal = id => document.getElementById(id)?.value || '';
    const getChk = id => document.getElementById(id)?.checked || false;

    const authors = [];
    document.querySelectorAll('.author-row').forEach(row => {
        const name = row.querySelector('.name-final-value').value;
        const role = row.querySelector('.role-final-value').value;
        if (name) authors.push({ name, role });
    });

    const images = getPreviewImages().filter(img => {
        if (img.type === 'embed') return true;
        return img.file && !img.file.startsWith('data:') && !img.file.startsWith('blob:');
    });

    return {
        title: getVal('post-title'),
        description: getVal('post-description'),
        content: getVal('post-content'),
        category: getVal('category-select'),
        tags: getVal('post-tags'),
        date: getVal('datePicker'),
        slug: getVal('post-slug'),
        seoTitle: getVal('seo-title'),
        seoDesc: getVal('seo-description'),
        featured: getChk('flag-featured'),
        commentsDisabled: getChk('comments-disabled'),
        authors,
        images,
        savedAt: Date.now()
    };
}

async function performAutosave(force = false) {
    const form = document.getElementById('create-post-form');
    if (!form) return;
    if (!force && !hasUnsavedChanges()) return;

    const key = getAutosaveKey(currentArticleId);
    const data = collectAutosaveData();
    const ok = await saveServerDraft(key, data);
    const el = document.getElementById('autosave-status');
    if (el) {
        if (ok) {
            const t = new Date(data.savedAt);
            el.style.color = '';
            el.textContent = `Saved at ${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
        } else {
            el.style.color = '#ef4444';
            el.textContent = 'Autosave failed!';
        }
    }
}

async function clearAutosave() {
    try { await deleteServerDraft(getAutosaveKey(currentArticleId)); } catch (e) {}
}

async function checkAutosave(articleId) {
    try {
        const key = getAutosaveKey(articleId);
        const result = await getServerDraft(key);
        if (!result || !result.draft) return null;
        const data = result.draft;
        if (!data.savedAt || Date.now() - data.savedAt > 7 * 24 * 60 * 60 * 1000) {
            await deleteServerDraft(key);
            return null;
        }
        return data;
    } catch (e) { return null; }
}

function restoreAutosave(data) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const check = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

    set('post-title', data.title || '');
    set('post-description', data.description || '');
    set('post-content', data.content || '');
    set('post-tags', data.tags || '');
    set('datePicker', data.date || '');
    set('post-slug', data.slug || '');
    set('seo-title', data.seoTitle || '');
    set('seo-description', data.seoDesc || '');
    check('flag-featured', data.featured || false);
    check('comments-disabled', data.commentsDisabled || false);
    if (data.category) document.getElementById('category-select').value = data.category;

    if (data.authors && data.authors.length > 0) {
        const authList = document.getElementById('authors-list');
        authList.innerHTML = '';
        data.authors.forEach(a => addAuthor(authList, a));
    }

    if (data.images && data.images.length > 0) {
        const mediaList = document.getElementById('media-list');
        mediaList.innerHTML = '';
        data.images.forEach(img => {
            if (img.type === 'embed') {
                addEmbed(mediaList, img);
            } else if (img.placement?.startsWith('Gallery')) {
                let group = Array.from(mediaList.children).find(c => c.classList.contains('gallery-group-item') && c.querySelector('.gallery-pos-value').value === img.placement);
                if (!group) { addGallery(mediaList, { position: img.placement, photos: [img] }); }
                else { addGalleryPhoto(group.querySelector('.gallery-photos-list'), img.placement, img); }
            } else {
                addImage(mediaList, img);
            }
        });
    }

    document.getElementById('post-title')?.dispatchEvent(new Event('input'));
    document.getElementById('post-content')?.dispatchEvent(new Event('input'));
}

function showAutosaveBanner(data) {
    const banner = document.getElementById('autosave-banner');
    if (!banner) return;
    const t = new Date(data.savedAt);

    banner.querySelector('.banner-text').innerHTML = `Showing saved draft from <span class="autosave-time" style="font-weight:700;">${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}</span>.`;

    const dismissBtn = banner.querySelector('#autosave-dismiss');
    const newDismissBtn = dismissBtn.cloneNode(true);
    dismissBtn.replaceWith(newDismissBtn);

    newDismissBtn.addEventListener('click', async () => {
        const promptMsg = currentArticleId 
            ? 'Are you sure you want to discard your server draft and reload the live version?'
            : 'Are you sure you want to discard this draft and start over?';

        if (confirm(promptMsg)) {
            await clearAutosave();
            location.reload();
        }
    });

    banner.style.display = 'flex';
}

// ─── Slug Helpers ─────────────────────────────────────────────────────────────
function titleToSlug(title) {
    return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// ─── Markdown Toolbar Helpers ─────────────────────────────────────────────────
function insertAtCursor(textarea, prefix, suffix = '', placeholder = 'text') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);
    const insert = prefix + (selected || placeholder) + suffix;
    textarea.value = textarea.value.substring(0, start) + insert + textarea.value.substring(end);
    textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selected || placeholder).length);
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

function insertLinePrefix(textarea, prefix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', end);
    const actualEnd = lineEnd === -1 ? text.length : lineEnd;
    const lines = text.substring(lineStart, actualEnd).split('\n');
    const prefixed = lines.map(l => prefix + l).join('\n');
    textarea.value = text.substring(0, lineStart) + prefixed + text.substring(actualEnd);
    if (lines.length === 1) {
        textarea.setSelectionRange(lineStart + prefix.length, lineStart + prefixed.length);
    } else {
        textarea.setSelectionRange(lineStart + prefixed.length, lineStart + prefixed.length);
    }
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

function toggleHeading(textarea, prefix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', end);
    const actualEnd = lineEnd === -1 ? text.length : lineEnd;
    const lines = text.substring(lineStart, actualEnd).split('\n');
    const headingRe = /^(#{1,6}) /;
    const newLines = lines.map(line => {
        const m = line.match(headingRe);
        if (m) {
            const stripped = line.slice(m[0].length);
            if (m[1] + ' ' === prefix) return stripped;
            return prefix + stripped;
        }
        return prefix + line;
    });
    const result = newLines.join('\n');
    textarea.value = text.substring(0, lineStart) + result + text.substring(actualEnd);
    if (newLines.length === 1) {
        const activePrefix = newLines[0].match(/^(#{1,6}) /);
        const contentStart = lineStart + (activePrefix ? activePrefix[0].length : 0);
        textarea.setSelectionRange(contentStart, lineStart + newLines[0].length);
    } else {
        textarea.setSelectionRange(lineStart + result.length, lineStart + result.length);
    }
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

function insertBlock(textarea, block) {
    const pos = textarea.selectionEnd;
    const before = textarea.value.substring(0, pos);
    const after = textarea.value.substring(pos);
    const prefix = (before.length > 0 && !before.endsWith('\n\n')) ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const insert = prefix + block + '\n\n';
    textarea.value = before + insert + after;
    textarea.setSelectionRange((before + insert).length, (before + insert).length);
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

function insertBlockWithSelection(textarea, block, selectStart, selectEnd) {
    const pos = textarea.selectionEnd;
    const before = textarea.value.substring(0, pos);
    const after = textarea.value.substring(pos);
    const prefix = (before.length > 0 && !before.endsWith('\n\n')) ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const insert = prefix + block + '\n\n';
    textarea.value = before + insert + after;
    const base = before.length + prefix.length;
    textarea.setSelectionRange(base + selectStart, base + selectEnd);
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

function setupTextareaShortcuts(textarea) {
    textarea.addEventListener('keydown', e => {
        if (!e.ctrlKey && !e.metaKey) return;
        switch (e.key.toLowerCase()) {
            case 'b':
                e.preventDefault();
                insertAtCursor(textarea, '**', '**', 'bold text');
                break;
            case 'i':
                e.preventDefault();
                insertAtCursor(textarea, '*', '*', 'italic text');
                break;
            case 'k': {
                e.preventDefault();
                const url = prompt('Enter URL:');
                if (url) insertAtCursor(textarea, '[', `](${url})`, 'link text');
                break;
            }
        }
    });
}

function toolbarHTML(targetId, showInsertImage = false) {
    return `
    <div class="md-toolbar" data-target="${targetId}">
        <button type="button" class="md-btn" data-action="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" class="md-btn" data-action="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" class="md-btn" data-action="strike" title="Strikethrough"><s>S</s></button>
        <span class="md-sep"></span>
        <button type="button" class="md-btn md-btn-heading" data-action="h1" title="Heading 1">H1</button>
        <button type="button" class="md-btn md-btn-heading" data-action="h2" title="Heading 2">H2</button>
        <button type="button" class="md-btn md-btn-heading" data-action="h3" title="Heading 3">H3</button>
        <button type="button" class="md-btn md-btn-heading" data-action="h4" title="Heading 4">H4</button>
        <span class="md-sep"></span>
        <button type="button" class="md-btn" data-action="link" title="Insert Link (Ctrl+K)">🔗</button>
        ${showInsertImage ? `<button type="button" class="md-btn" data-action="image" title="Insert Image">🖼</button>` : ''}
        <button type="button" class="md-btn" data-action="embed" title="Insert Embed">${icons.embed}</button>
        <button type="button" class="md-btn" data-action="quote" title="Blockquote">❝</button>
        <span class="md-sep"></span>
        <button type="button" class="md-btn" data-action="code" title="Inline Code">&lt;/&gt;</button>
        <button type="button" class="md-btn" data-action="codeblock" title="Code Block" style="font-size:0.75rem;">&#96;&#96;&#96;</button>
        <button type="button" class="md-btn" data-action="table" title="Insert Table">⊞</button>
        <button type="button" class="md-btn" data-action="hr" title="Horizontal Rule">—</button>
        <button type="button" class="md-btn" data-action="ul" title="Bullet List">•</button>
        <button type="button" class="md-btn" data-action="ol" title="Numbered List">1.</button>
    </div>`;
}

function setupToolbar(toolbarEl) {
    const targetId = toolbarEl.dataset.target;
    toolbarEl.addEventListener('click', e => {
        const btn = e.target.closest('.md-btn');
        if (!btn) return;
        e.preventDefault();
        const textarea = document.getElementById(targetId);
        if (!textarea) return;

        switch (btn.dataset.action) {
            case 'bold':      insertAtCursor(textarea, '**', '**', 'bold text'); break;
            case 'italic':    insertAtCursor(textarea, '*', '*', 'italic text'); break;
            case 'strike':    insertAtCursor(textarea, '~~', '~~', 'strikethrough text'); break;
            case 'h1':        toggleHeading(textarea, '# '); break;
            case 'h2':        toggleHeading(textarea, '## '); break;
            case 'h3':        toggleHeading(textarea, '### '); break;
            case 'h4':        toggleHeading(textarea, '#### '); break;
            case 'link':      const url = prompt('Enter URL:'); if (url) insertAtCursor(textarea, '[', `](${url})`, 'link text'); break;
            case 'image':     
                const imgUrl = prompt('Enter image URL:'); 
                if (imgUrl) {
                    const altText = prompt('Enter image caption (optional):') || '';
                    const creditText = prompt('Enter image credit (optional):') || '';
                    const titlePart = creditText ? ` "${creditText}"` : '';
                    insertBlock(textarea, `![${altText}](${imgUrl}${titlePart})`); 
                }
                break;
            case 'embed':     
                const modal = document.getElementById('embed-modal');
                if (modal) {
                    const text = textarea.value;
                    const cursorPos = textarea.selectionStart;

                    const regex = /```embed\n([\s\S]*?)\n```/g;
                    let match;
                    let activeBlock = null;
                    while ((match = regex.exec(text)) !== null) {
                        if (cursorPos >= match.index && cursorPos <= match.index + match[0].length) {
                            activeBlock = {
                                start: match.index,
                                end: match.index + match[0].length,
                                content: match[1]
                            };
                            break;
                        }
                    }

                    const codeInput = document.getElementById('embed-input-code');
                    const heightInput = document.getElementById('embed-input-height');
                    const submitBtn = document.getElementById('insert-embed-btn');

                    if (activeBlock) {
                        codeInput.value = activeBlock.content;
                        const hMatch = activeBlock.content.match(/height=["']?(\d+)/i) || activeBlock.content.match(/height:\s*(\d+)px/i);
                        heightInput.value = hMatch ? hMatch[1] : '700';
                        submitBtn.textContent = 'Update';
                        modal.dataset.editStart = activeBlock.start;
                        modal.dataset.editEnd = activeBlock.end;
                    } else {
                        codeInput.value = '';
                        heightInput.value = '700';
                        submitBtn.textContent = 'Insert';
                        delete modal.dataset.editStart;
                        delete modal.dataset.editEnd;
                    }

                    modal.style.display = 'flex';
                    modal.dataset.targetId = targetId;
                    codeInput.focus();
                }
                break;
            case 'quote':     insertLinePrefix(textarea, '> '); break;
            case 'code':      insertAtCursor(textarea, '`', '`', 'code'); break;
            case 'codeblock': {
                const cbBlock = '```\ncode here\n```';
                insertBlockWithSelection(textarea, cbBlock, 4, 13);
                break;
            }
            case 'table': {
                const existing = parseTableAtCursor(textarea);
                const parsed   = existing ? parseMarkdownTable(existing.text) : null;
                openTableModal(textarea, existing, parsed);
                break;
            }
            case 'hr':        insertBlock(textarea, '---'); break;
            case 'ul':        insertLinePrefix(textarea, '- '); break;
            case 'ol':        insertLinePrefix(textarea, '1. '); break;
        }
    });
}

function setupEmbedModal() {
    const modal = document.getElementById('embed-modal');
    const insertBtn = document.getElementById('insert-embed-btn');
    if (!insertBtn || !modal) return;

    const closeEmbedModal = () => {
        modal.style.display = 'none';
    };

    insertBtn.addEventListener('click', () => {
        const codeInput = document.getElementById('embed-input-code');
        const code = codeInput.value.trim();
        const height = document.getElementById('embed-input-height').value || '700';
        const targetId = modal.dataset.targetId;
        const textarea = document.getElementById(targetId);

        if (!code || !textarea) return;

        let finalHtml = code;
        const isUrl = /^https?:\/\//i.test(code);

        if (isUrl) {
            let src = code;
            const ytMatch = code.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
            if (ytMatch) src = `https://www.youtube.com/embed/${ytMatch[1]}`;
            const spMatch = code.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/i);
            if (spMatch) src = `https://open.spotify.com/embed/${spMatch[1]}/${spMatch[2]}`;

            finalHtml = `<iframe src="${src}" width="100%" height="${height}" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
        } else {
            if (finalHtml.includes('<iframe')) {
                finalHtml = finalHtml.replace(/height=["']?\d+["']?/i, `height="${height}"`);
                if (!finalHtml.includes('width=')) {
                    finalHtml = finalHtml.replace('<iframe', '<iframe width="100%"');
                } else {
                    finalHtml = finalHtml.replace(/width=["']?[^"']+["']?/i, 'width="100%"');
                }
            } else {
                const wrapperMatch = finalHtml.match(/^<div style="width: 100%; height: \d+px; overflow: auto;">([\s\S]*?)<\/div>$/i);
                if (wrapperMatch) finalHtml = wrapperMatch[1];
                finalHtml = `<div style="width: 100%; height: ${height}px; overflow: auto;">${finalHtml}</div>`;
            }
        }

        const embedBlock = `\`\`\`embed\n${finalHtml}\n\`\`\``;

        if (modal.dataset.editStart !== undefined && modal.dataset.editEnd !== undefined) {
            const start = parseInt(modal.dataset.editStart, 10);
            const end = parseInt(modal.dataset.editEnd, 10);
            textarea.value = textarea.value.substring(0, start) + embedBlock + textarea.value.substring(end);
            textarea.setSelectionRange(start, start + embedBlock.length);
            textarea.dispatchEvent(new Event('input'));
        } else {
            insertBlock(textarea, embedBlock);
        }

        closeEmbedModal();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeEmbedModal();
    });

    ['close-embed-modal', 'cancel-embed-modal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', closeEmbedModal);
    });
}

// ─── Table Modal Logic ────────────────────────────────────────────────────────
function renderTableGrid(cols, rows, data) {
    const container = document.getElementById('table-grid-container');
    if (!container) return;
    container.innerHTML = '';

    const table = document.createElement('table');
    table.style.cssText = 'border-collapse: collapse; width: 100%;';

    for (let r = 0; r < 1 + rows; r++) {
        const tr = document.createElement('tr');
        for (let c = 0; c < cols; c++) {
            const isHeader = r === 0;
            const td = document.createElement('td');
            td.style.cssText = 'border: 1px solid #e2e8f0; padding: 0;' + (isHeader ? ' background: #f1f5f9;' : '');
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'table-cell-input';
            inp.dataset.row = r;
            inp.dataset.col = c;
            inp.value = (data && data[r] && data[r][c] !== undefined) ? data[r][c] : '';
            inp.placeholder = isHeader ? `Header ${c + 1}` : '';
            inp.style.cssText = `display:block; width:100%; border:none; background:transparent; padding:5px 8px; font-size:0.85rem; font-weight:${isHeader ? '600' : '400'}; outline:none; min-width:90px; box-sizing:border-box;`;
            inp.addEventListener('focus', () => { td.style.outline = '2px solid var(--editor-accent)'; td.style.outlineOffset = '-2px'; });
            inp.addEventListener('blur',  () => { td.style.outline = ''; td.style.outlineOffset = ''; });
            td.appendChild(inp);
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
    container.appendChild(table);

    const inputs = Array.from(container.querySelectorAll('.table-cell-input'));
    inputs.forEach((inp, idx) => {
        inp.addEventListener('keydown', e => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const next = inputs[e.shiftKey ? idx - 1 : idx + 1];
                if (next) next.focus();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const nextRow = inputs.find(i => parseInt(i.dataset.row) === parseInt(inp.dataset.row) + 1 && parseInt(i.dataset.col) === parseInt(inp.dataset.col));
                if (nextRow) nextRow.focus();
            }
        });
    });
}

function parseTableAtCursor(textarea) {
    const text = textarea.value;
    const cursor = textarea.selectionStart;
    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    const lineEnd = text.indexOf('\n', cursor);
    const currentLine = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
    if (!currentLine.trim().startsWith('|')) return null;

    let tableStart = lineStart;
    while (tableStart > 0) {
        const prevEnd = tableStart - 1;
        const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
        if (!text.substring(prevStart, prevEnd).trim().startsWith('|')) break;
        tableStart = prevStart;
    }

    let tableEnd = lineEnd === -1 ? text.length : lineEnd;
    while (tableEnd < text.length) {
        const nextStart = tableEnd + 1;
        const nextEnd = text.indexOf('\n', nextStart);
        if (!text.substring(nextStart, nextEnd === -1 ? text.length : nextEnd).trim().startsWith('|')) break;
        tableEnd = nextEnd === -1 ? text.length : nextEnd;
    }

    return { start: tableStart, end: tableEnd, text: text.substring(tableStart, tableEnd) };
}

function parseMarkdownTable(tableText) {
    const lines = tableText.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
    if (lines.length < 1) return null;
    const parseRow = line => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headerCells = parseRow(lines[0]);
    const cols = headerCells.length;
    const dataLines = lines.slice(1).filter(l => !/^\|[\s|:-]+\|$/.test(l));
    const dataRows = dataLines.map(row => {
        const cells = parseRow(row);
        return Array.from({ length: cols }, (_, c) => cells[c] !== undefined ? cells[c] : '');
    });
    return { headerCells, dataRows, cols, rows: dataRows.length };
}

function findAllMarkdownTables(text) {
    const tables = [];
    const lines = text.split('\n');
    let pos = 0, i = 0;
    while (i < lines.length) {
        if (lines[i].trim().startsWith('|')) {
            const start = pos;
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableLines.push(lines[i]);
                pos += lines[i].length + 1;
                i++;
            }
            const tableText = tableLines.join('\n');
            tables.push({ start, end: start + tableText.length, text: tableText });
        } else {
            pos += lines[i].length + 1;
            i++;
        }
    }
    return tables;
}

function openTableModal(textarea, existingTable, parsedTable) {
    const modal = document.getElementById('table-modal');
    if (!modal) return;

    modal.dataset.targetId = textarea.id;
    delete modal.dataset.editStart;
    delete modal.dataset.editEnd;

    const dimRow     = document.getElementById('table-dim-row');
    const modalTitle = document.getElementById('table-modal-title');
    const insertBtn  = document.getElementById('insert-table-btn');

    if (parsedTable && existingTable) {
        modal.dataset.editStart = existingTable.start;
        modal.dataset.editEnd   = existingTable.end;
        if (dimRow)     dimRow.style.display     = 'flex';
        if (modalTitle) modalTitle.textContent   = 'Edit Table';
        if (insertBtn)  insertBtn.textContent    = 'Update Table';
        const colsEl = document.getElementById('table-cols');
        const rowsEl = document.getElementById('table-rows');
        if (colsEl) colsEl.value = parsedTable.cols;
        if (rowsEl) rowsEl.value = parsedTable.rows;
        const savedData = (savedTableModalState?.editStart === String(existingTable.start))
            ? savedTableModalState.data : null;
        const data = savedData || [parsedTable.headerCells, ...parsedTable.dataRows];
        renderTableGrid(parsedTable.cols, parsedTable.rows, data);
    } else {
        if (dimRow)     dimRow.style.display     = 'flex';
        if (modalTitle) modalTitle.textContent   = 'Insert Table';
        if (insertBtn)  insertBtn.textContent    = 'Insert Table';
        const cols = parseInt(document.getElementById('table-cols')?.value, 10) || 3;
        const rows = parseInt(document.getElementById('table-rows')?.value, 10) || 2;
        const savedData = (!savedTableModalState?.editStart && savedTableModalState?.data)
            ? savedTableModalState.data : null;
        renderTableGrid(cols, rows, savedData);
    }

    modal.style.display = 'flex';
    const firstInp = document.querySelector('#table-grid-container .table-cell-input');
    if (firstInp) firstInp.focus();
}

function buildTableMarkdown() {
    const inputs = Array.from(document.querySelectorAll('#table-grid-container .table-cell-input'));
    if (!inputs.length) return '';
    const maxRow = Math.max(...inputs.map(i => parseInt(i.dataset.row)));
    const maxCol = Math.max(...inputs.map(i => parseInt(i.dataset.col)));
    const getVal = (r, c) => {
        const inp = inputs.find(i => parseInt(i.dataset.row) === r && parseInt(i.dataset.col) === c);
        return inp ? inp.value.trim() : '';
    };
    const headers = Array.from({ length: maxCol + 1 }, (_, c) => getVal(0, c) || `Column ${c + 1}`);
    const headerRow = '| ' + headers.join(' | ') + ' |';
    const sepRow    = '| ' + headers.map(() => '---').join(' | ') + ' |';
    const dataRows  = Array.from({ length: maxRow }, (_, r) =>
        '| ' + Array.from({ length: maxCol + 1 }, (_, c) => getVal(r + 1, c)).join(' | ') + ' |'
    ).join('\n');
    return dataRows ? `${headerRow}\n${sepRow}\n${dataRows}` : `${headerRow}\n${sepRow}`;
}

function tableToMarkdown(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (!rows.length) return '';
    const getCells = tr => Array.from(tr.querySelectorAll('td, th')).map(cell => cell.textContent.trim());
    const headers   = getCells(rows[0]);
    const headerRow = '| ' + headers.join(' | ') + ' |';
    const sepRow    = '| ' + headers.map(() => '---').join(' | ') + ' |';
    const dataRows  = rows.slice(1).map(tr => '| ' + getCells(tr).join(' | ') + ' |').join('\n');
    return dataRows ? `${headerRow}\n${sepRow}\n${dataRows}` : `${headerRow}\n${sepRow}`;
}

function setupTableModal() {
    const modal = document.getElementById('table-modal');
    if (!modal) return;

    const closeTableModal = (clearState = false) => {
        if (clearState === true) {
            savedTableModalState = null;
        } else {
            const inputs = Array.from(document.querySelectorAll('#table-grid-container .table-cell-input'));
            if (inputs.length > 0) {
                const data = [];
                inputs.forEach(inp => {
                    const r = parseInt(inp.dataset.row), c = parseInt(inp.dataset.col);
                    if (!data[r]) data[r] = [];
                    data[r][c] = inp.value;
                });
                savedTableModalState = { editStart: modal.dataset.editStart, data };
            }
        }
        modal.style.display = 'none';
        delete modal.dataset.editStart;
        delete modal.dataset.editEnd;
    };

    const syncGrid = () => {
        const cols = Math.max(1, Math.min(8,  parseInt(document.getElementById('table-cols').value,  10) || 3));
        const rows = Math.max(1, Math.min(20, parseInt(document.getElementById('table-rows').value, 10) || 2));
        const existing = Array.from(document.querySelectorAll('#table-grid-container .table-cell-input'));
        const data = [];
        existing.forEach(inp => {
            const r = parseInt(inp.dataset.row), c = parseInt(inp.dataset.col);
            if (!data[r]) data[r] = [];
            data[r][c] = inp.value;
        });
        renderTableGrid(cols, rows, data);
    };

    document.getElementById('table-cols')?.addEventListener('input', syncGrid);
    document.getElementById('table-rows')?.addEventListener('input', syncGrid);

    document.getElementById('insert-table-btn')?.addEventListener('click', () => {
        const targetId = modal.dataset.targetId;
        const textarea = document.getElementById(targetId);
        if (!textarea) return;
        const markdown = buildTableMarkdown();
        if (!markdown) return;

        if (modal.dataset.editStart !== undefined && modal.dataset.editEnd !== undefined) {
            const start = parseInt(modal.dataset.editStart, 10);
            const end   = parseInt(modal.dataset.editEnd,   10);
            textarea.value = textarea.value.substring(0, start) + markdown + textarea.value.substring(end);
            textarea.setSelectionRange(start, start + markdown.length);
            textarea.dispatchEvent(new Event('input'));
        } else {
            insertBlock(textarea, markdown);
        }
        closeTableModal(true);
    });

    modal.addEventListener('click', (e) => { if (e.target === modal) closeTableModal(false); });
    ['close-table-modal', 'cancel-table-modal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => closeTableModal(false));
    });
}

// ─── Previews & Images Extraction ─────────────────────────────────────────────
function renderMarkdown(md) {
    if (window.marked && marked.parse) {
        registerEmbedExtension();
        return marked.parse(md);
    }
    return `<pre>${md}</pre>`;
}

function getPreviewImages() {
    const items = [];

    document.querySelectorAll('#media-list .single-image-item').forEach(card => {
        const urlInput = card.querySelector('.image-url-input');
        const previewThumb = card.querySelector('.image-preview-thumb');
        const placement = card.querySelector('.placement-final').value;
        const caption = card.querySelector('.image-caption-input').value;
        const credit = card.querySelector('input[name="image_credits[]"]').value;

        let file = urlInput.value.trim();
        if (!file && previewThumb.style.display !== 'none' && previewThumb.src) {
            file = previewThumb.src;
        }
        if (file) items.push({ type: 'image', file, placement, caption, credit, alt: '' });
    });

    document.querySelectorAll('#media-list .gallery-photo-entry').forEach(entry => {
        const urlInput = entry.querySelector('.gallery-url-input');
        const preview = entry.querySelector('.gallery-preview-thumb');
        const placement = entry.querySelector('.gallery-placement').value;
        const caption = entry.querySelector('.gallery-caption-input').value;
        const credit = entry.querySelector('.gallery-credit-input').value;

        let file = urlInput ? urlInput.value.trim() : '';
        if (!file && preview && preview.style.display !== 'none' && preview.src) {
            file = preview.src;
        }
        if (file) items.push({ type: 'image', file, placement, caption, credit, alt: '' });
    });

    document.querySelectorAll('#media-list .embed-item').forEach(card => {
        const code = card.querySelector('.embed-code-hidden').value.trim();
        const placement = card.querySelector('.placement-final').value;
        const width = card.querySelector('.embed-width-input').value.trim() || '100%';
        const height = card.querySelector('.embed-height-input').value || '560';
        if (code) items.push({ type: 'embed', code, placement, width, height });
    });

    return items;
}

function renderArticlePreview(textareaValue) {
    const rawHtml = renderMarkdown(textareaValue);
    const mediaItems = getPreviewImages();
    const { mainContent, bottomContent } = injectImagesIntoContent(rawHtml, mediaItems);
    return `<div class="single-article-content" style="margin:0; padding:0; max-width:none;">${mainContent}${bottomContent}</div>`;
}

function setupPreviewToggle(toggleBtn, textarea, previewEl, isDesc = false) {
    let isPreviewing = false;
    const controls = { onActivate: null };

    const liveUpdateFn = () => {
        if (isPreviewing) {
            previewEl.innerHTML = isDesc ? renderMarkdown(textarea.value) : renderArticlePreview(textarea.value);
        }
    };

    controls.exit = () => {
        if (!isPreviewing) return;
        isPreviewing = false;
        previewEl.style.display = 'none';
        textarea.style.display = '';
        toggleBtn.textContent = 'Preview';
        toggleBtn.classList.remove('active');
    };

    textarea.addEventListener('input', liveUpdateFn);

    toggleBtn.addEventListener('click', () => {
        isPreviewing = !isPreviewing;
        if (isPreviewing) {
            controls.onActivate?.();
            liveUpdateFn();
            previewEl.style.display = 'block';
            textarea.style.display = 'none';
            toggleBtn.textContent = 'Edit';
            toggleBtn.classList.add('active');
        } else {
            previewEl.style.display = 'none';
            textarea.style.display = '';
            toggleBtn.textContent = 'Preview';
            toggleBtn.classList.remove('active');
        }
    });

    return controls;
}

function setupSplitView(splitBtn, textarea, previewEl, section) {
    let isSplit = false;
    let liveUpdateFn = null;
    let resizeHandle = null;
    const controls = { onActivate: null };

    controls.exit = () => {
        if (!isSplit) return;
        isSplit = false;
        section.classList.remove('split-view-active');
        splitBtn.classList.remove('active');
        previewEl.style.display = 'none';
        textarea.style.width = '';
        textarea.style.flex = '';
        previewEl.style.flex = '';
        previewEl.style.minWidth = '';
        if (liveUpdateFn) { textarea.removeEventListener('input', liveUpdateFn); liveUpdateFn = null; }
        if (resizeHandle) { resizeHandle.remove(); resizeHandle = null; }
    };

    splitBtn.addEventListener('click', () => {
        isSplit = !isSplit;
        section.classList.toggle('split-view-active', isSplit);
        splitBtn.classList.toggle('active', isSplit);
        if (isSplit) {
            controls.onActivate?.();
            textarea.style.display = '';
            previewEl.style.display = 'block';
            previewEl.innerHTML = renderArticlePreview(textarea.value);
            liveUpdateFn = () => { previewEl.innerHTML = renderArticlePreview(textarea.value); };
            textarea.addEventListener('input', liveUpdateFn);

            const wrap = textarea.parentElement;
            resizeHandle = document.createElement('div');
            resizeHandle.className = 'split-resize-handle';
            resizeHandle.title = 'Drag to resize';
            wrap.insertBefore(resizeHandle, previewEl);

            const totalWidth = wrap.getBoundingClientRect().width;
            textarea.style.width = `${Math.floor(totalWidth / 2)}px`;
            textarea.style.flex = '0 0 auto';
            previewEl.style.flex = '1 1 0';
            previewEl.style.minWidth = '0';

            let startX, startWidth, cachedWrapWidth, cachedHandleWidth, rafId, latestX;
            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startX = e.clientX;
                latestX = e.clientX;
                startWidth = textarea.getBoundingClientRect().width;
                cachedWrapWidth = wrap.getBoundingClientRect().width;
                cachedHandleWidth = resizeHandle.offsetWidth;
                resizeHandle.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                const onMouseMove = (ev) => {
                    latestX = ev.clientX;
                    if (rafId) return;
                    rafId = requestAnimationFrame(() => {
                        const delta = latestX - startX;
                        const newWidth = Math.max(200, Math.min(startWidth + delta, cachedWrapWidth - cachedHandleWidth - 200));
                        textarea.style.width = `${newWidth}px`;
                        rafId = null;
                    });
                };

                const onMouseUp = () => {
                    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                    resizeHandle.classList.remove('dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        } else {
            previewEl.style.display = 'none';
            textarea.style.width = '';
            textarea.style.flex = '';
            previewEl.style.flex = '';
            previewEl.style.minWidth = '';
            if (liveUpdateFn) { textarea.removeEventListener('input', liveUpdateFn); liveUpdateFn = null; }
            if (resizeHandle) { resizeHandle.remove(); resizeHandle = null; }
        }
    });

    return controls;
}

function setupFullscreen(fsBtn) {
    const workspace = document.querySelector('.editor-app-workspace');
    fsBtn.addEventListener('click', () => {
        workspace.classList.toggle('content-fullscreen');
        const isFs = workspace.classList.contains('content-fullscreen');
        fsBtn.innerHTML = isFs ? icons_svg.exitFs : icons_svg.enterFs;
    });
}

function triggerPreviewUpdate() {
    if (document.querySelector('.split-view-active') || document.getElementById('content-preview').style.display === 'block') {
        document.getElementById('post-content').dispatchEvent(new Event('input'));
    }
}

// ─── Placement UI Sync Helper ──────────────────────────────────────────────────
function syncPlacementUI(card) {
    const input = card.querySelector('.placement-final, .gallery-pos-value');
    if (!input) return;
    const val = input.value || '';
    const btns = card.querySelectorAll('.btn-pick-block');

    btns.forEach(b => {
        b.classList.remove('has-value');
        if (b.dataset.align === 'Left') b.innerHTML = '◧ Left';
        if (b.dataset.align === 'Center') b.innerHTML = '■ Center';
        if (b.dataset.align === 'Right') b.innerHTML = '◨ Right';
        if (b.dataset.align === 'Gallery Custom') b.innerHTML = '🎯 Place in text';
    });

    let alignMatch = null;
    let indexMatch = null;

    if (val.startsWith('Custom') || val.startsWith('Gallery Custom')) {
        const match = val.match(/(Left|Center|Right|Gallery Custom)(?:\s+(\d+))?/i);
        if (match) {
            alignMatch = match[1];
            indexMatch = match[2];
        }
    } else if (val.startsWith('Top')) {
        const match = val.match(/Top (Left|Center|Right)/i);
        if (match && match[1] !== 'Center') { 
            alignMatch = match[1];
            indexMatch = '1';
            input.value = `Custom ${alignMatch} 1`; 
        }
    } else if (val.startsWith('Bottom')) {
        const match = val.match(/Bottom (Left|Right)/i);
        if (match) {
            alignMatch = match[1];
            indexMatch = 'End';
        }
    }

    if (alignMatch) {
        const activeBtn = card.querySelector(`.btn-pick-block[data-align="${alignMatch}"]`);
        if (activeBtn) {
            activeBtn.classList.add('has-value');
        }
    }
}

function placementSortKey(placement) {
    if (!placement) return 999;
    const p = placement.toLowerCase();
    if (p.includes('top')) return 0;
    if (p.includes('bottom')) return 10000;
    const match = p.match(/\d+/);
    return match ? parseInt(match[0], 10) : 500;
}

// ─── Hybrid Inputs (Authors) ──────────────────────────────────────────────────
function setupHybridInput(wrapper, prefix, prefillValue = null, isLocked = false) {
    const group = wrapper.querySelector(`.${prefix}-input-group`);
    const select = group.querySelector(`.select-input`);
    const textInput = group.querySelector(`.text-input`);
    const hiddenInput = group.querySelector(`.${prefix}-final-value`);

    const setValue = (val) => {
        let found = false;
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === val) { select.selectedIndex = i; found = true; break; }
        }
        if (found) {
            group.classList.remove('show-custom');
            textInput.disabled = true;
            hiddenInput.value = val;
        } else {
            select.value = 'custom_entry';
            group.classList.add('show-custom');
            textInput.disabled = false;
            textInput.value = val;
            hiddenInput.value = val;
        }
    };

    if (prefillValue) setValue(prefillValue);

    if (isLocked) {
        select.disabled = true;
        textInput.disabled = true;
        hiddenInput.value = prefillValue || select.value;
    } else {
        select.addEventListener('change', () => {
            if (select.value === 'custom_entry') {
                group.classList.add('show-custom');
                textInput.disabled = false;
                textInput.focus();
                hiddenInput.value = '';
            } else {
                group.classList.remove('show-custom');
                textInput.disabled = true;
                hiddenInput.value = select.value;
            }
        });
        textInput.addEventListener('input', () => { hiddenInput.value = textInput.value; });
    }
}

function addAuthor(container, prefill = null) {
    let nameOptions = '<option value="" disabled selected>Select Name</option>';
    nameOptions += `<option value="ANDOVERVIEW" data-role="Editorial Board">ANDOVERVIEW</option>`;
    staffList.forEach(p => { nameOptions += `<option value="${p.name}" data-role="${p.role || ''}">${p.name}</option>`; });
    nameOptions += `<option value="custom_entry">Other...</option>`;

    let roleOptions = '<option value="" disabled selected>Select Role</option>';
    commonRoles.forEach(r => { roleOptions += `<option value="${r}" ${(!prefill && r === 'Staff Writer') ? 'selected' : ''}>${r}</option>`; });
    roleOptions += `<option value="custom_entry">Other...</option>`;

    const isLocked = prefill?.locked || false;

    const row = document.createElement('div');
    row.className = 'author-row';
    row.style.display = 'flex'; row.style.gap = '0.75rem'; row.style.alignItems = 'center';

    row.innerHTML = `
        <div class="author-input-group name-input-group">
            <select class="input-base select-input">${nameOptions}</select>
            <input type="text" class="input-base text-input" placeholder="Type Name" disabled>
            <input type="hidden" name="author_final_names[]" class="name-final-value">
        </div>
        <div class="author-input-group role-input-group">
            <select class="input-base select-input">${roleOptions}</select>
            <input type="text" class="input-base text-input" placeholder="Type Role" disabled>
            <input type="hidden" name="author_final_roles[]" class="role-final-value" value="${prefill ? prefill.role : 'Staff Writer'}">
        </div>
        <button type="button" class="btn-icon-plain delete-row-btn" style="${isLocked ? 'display:none;' : ''}">${icons.trash}</button>
    `;

    container.appendChild(row);
    setupHybridInput(row, 'name', prefill?.name, isLocked);
    setupHybridInput(row, 'role', prefill?.role, isLocked);
    row.querySelectorAll('.text-input').forEach(setupSmartQuotes);

    if (!isLocked) {
        const nameSelect = row.querySelector('.name-input-group .select-input');
        const roleSelect = row.querySelector('.role-input-group .select-input');
        const roleText = row.querySelector('.role-input-group .text-input');
        const roleHidden = row.querySelector('.role-final-value');
        const roleGroup = row.querySelector('.role-input-group');

        nameSelect.addEventListener('change', () => {
            const role = nameSelect.options[nameSelect.selectedIndex].dataset.role;
            if (role) {
                let matched = false;
                for (let i = 0; i < roleSelect.options.length; i++) {
                    if (roleSelect.options[i].value === role) { roleSelect.selectedIndex = i; matched = true; break; }
                }
                if (matched) {
                    roleGroup.classList.remove('show-custom');
                    roleText.disabled = true;
                    roleHidden.value = role;
                } else {
                    roleSelect.value = 'custom_entry';
                    roleGroup.classList.add('show-custom');
                    roleText.disabled = false;
                    roleText.value = role;
                    roleHidden.value = role;
                }
            }
        });
    }

    row.querySelector('.delete-row-btn')?.addEventListener('click', () => row.remove());
}

// ─── Media (Right Pane - Images & Galleries) ──────────────────────────────────

let globalImageCounter = 0;

function addImage(container, prefill = null) {
    const index = globalImageCounter++;

    const safePrefillFile = prefill && prefill.file ? prefill.file.replace(/"/g, '&quot;') : '';
    const safePrefillCaption = prefill && prefill.caption ? prefill.caption.replace(/"/g, '&quot;') : '';
    const safePrefillCredit = prefill && prefill.credit ? prefill.credit.replace(/"/g, '&quot;') : '';

    const html = `
        <div class="media-item-card single-image-item">
            <div class="media-item-header">
                <span class="media-item-label">${container.children.length === 0 ? 'Cover Image' : 'Image'}</span>
                <button type="button" class="btn-icon-plain delete-row-btn" style="height: 26px; width: 26px;">${icons.trash}</button>
            </div>
            <div class="media-item-body">
                <div class="media-horizontal-layout">
                    <div class="media-upload-area" title="Click or drag to upload">
                        <div class="media-upload-placeholder">${icons.upload}</div>
                        <img class="image-preview-thumb" src="${safePrefillFile}" style="display: ${safePrefillFile ? 'block' : 'none'};">
                        <input type="file" name="image_placeholder_${index}" class="image-file-input" accept="image/*">
                    </div>
                    <div class="media-inputs">
                        <div class="placement-toolbar" style="background:#f1f5f9; padding:0.5rem; border-radius:6px; margin-bottom:0.6rem; display:flex; flex-direction:column; gap:0.4rem;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.7rem; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.04em;">Align with Block</span>
                                <button type="button" class="btn-icon-plain btn-reset-placement" title="Reset to Top" style="width:20px; height:20px; font-size:14px; color:var(--color-text-secondary);">↺</button>
                            </div>
                            <div style="display:flex; gap:0.25rem; flex-wrap:wrap;">
                                <button type="button" class="btn-tool btn-pick-block" data-align="Left" title="Align Left" style="flex:1; justify-content:center; padding:0 0.25rem; min-width:60px;">◧ Left</button>
                                <button type="button" class="btn-tool btn-pick-block" data-align="Center" title="Place above" style="flex:1; justify-content:center; padding:0 0.25rem; min-width:60px;">■ Center</button>
                                <button type="button" class="btn-tool btn-pick-block" data-align="Right" title="Align Right" style="flex:1; justify-content:center; padding:0 0.25rem; min-width:60px;">◨ Right</button>
                            </div>
                            <input type="hidden" name="image_placements[]" class="placement-final" value="${prefill ? prefill.placement : 'Top Center'}">
                        </div>
                        <input type="text" name="image_urls[]" class="input-base input-compact image-url-input" placeholder="Or external URL..." value="${safePrefillFile}" autocomplete="off">
                        <div class="media-input-row">
                            <input type="text" name="image_captions[]" class="input-base input-compact image-caption-input" placeholder="Caption" value="${safePrefillCaption}">
                            <input type="text" name="image_credits[]" class="input-base input-compact" placeholder="Credit" value="${safePrefillCredit}">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const el = document.createElement('div');
    el.innerHTML = html.trim();
    const card = el.firstChild;
    container.appendChild(card);

    const fileInput = card.querySelector('.image-file-input');
    const urlInput = card.querySelector('.image-url-input');
    const previewImg = card.querySelector('.image-preview-thumb');
    const uploadArea = card.querySelector('.media-upload-area');
    const uploadPlaceholder = card.querySelector('.media-upload-placeholder');

    const showPreview = (src) => {
        if (src) { previewImg.src = src; previewImg.style.display = 'block'; uploadPlaceholder.style.display = 'none'; } 
        else { previewImg.style.display = 'none'; uploadPlaceholder.style.display = 'flex'; }
        triggerPreviewUpdate();
    };

    fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            const reader = new FileReader();
            reader.onload = e => showPreview(e.target.result);
            reader.readAsDataURL(this.files[0]);
            urlInput.value = '';
        }
    });

    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.style.borderColor = 'var(--editor-accent)'; });
    uploadArea.addEventListener('dragleave', () => uploadArea.style.borderColor = '');
    uploadArea.addEventListener('drop', e => {
        e.preventDefault(); uploadArea.style.borderColor = '';
        if (e.dataTransfer.files[0]) {
            const dt = new DataTransfer(); dt.items.add(e.dataTransfer.files[0]);
            fileInput.files = dt.files; fileInput.dispatchEvent(new Event('change'));
        }
    });

    urlInput.addEventListener('input', () => {
        if (urlInput.value) { fileInput.value = ''; showPreview(urlInput.value); }
        else { showPreview(null); }
    });

    const captionInput = card.querySelector('.image-caption-input');
    const creditInput = card.querySelector('input[name="image_credits[]"]');
    setupSmartQuotes(captionInput);
    setupSmartQuotes(creditInput);
    captionInput.addEventListener('input', triggerPreviewUpdate);
    creditInput.addEventListener('input', triggerPreviewUpdate);

    card.querySelector('.delete-row-btn').addEventListener('click', () => {
        card.remove();
        triggerPreviewUpdate();
    });

    syncPlacementUI(card);
}

function addGallery(container, prefill = null) {
    const position = prefill ? (prefill.position || 'Gallery Top') : 'Gallery Top';
    const isCustom = position.startsWith('Gallery Custom');
    const num = isCustom ? (position.match(/Gallery Custom\s*(\d+)/i)?.[1] || '1') : '1';

    const html = `
        <div class="media-item-card gallery-group-item">
            <div class="media-item-header" style="background: #f0fdf4; border-bottom-color: #bbf7d0; flex-wrap: wrap; gap: 0.5rem;">
                <div style="display:flex; gap:0.5rem; align-items:center; width:100%;">
                    <span class="media-item-label" style="color: #166534; margin-right:auto;">Photo Gallery</span>
                    <button type="button" class="btn-tool btn-pick-block" data-align="Gallery Custom" title="Place gallery after a block" style="color:#166534; background:#dcfce7; padding:0 0.5rem; min-width: 80px;">🎯 Place in text</button>
                    <button type="button" class="btn-icon-plain btn-reset-placement" title="Reset to Top" style="width:24px; height:24px; color:#166534;">↺</button>
                    <input type="hidden" class="gallery-pos-value" value="${position}">
                    <button type="button" class="btn-icon-plain delete-row-btn" style="margin-left:0.5rem; height:26px; width:26px; color: #166534;">${icons.trash}</button>
                </div>
            </div>
            <div class="media-item-body" style="padding-top: 0.5rem;">
                <div class="gallery-photos-list" style="display:flex; flex-direction:column;"></div>
                <button type="button" class="btn-text-action gallery-add-photo-btn" style="margin-top: 0.5rem; justify-content: center; width: 100%; border: 1px dashed #cbd5e1; padding: 0.5rem; border-radius: 6px;">+ Add Photo to Gallery</button>
            </div>
        </div>
    `;

    const el = document.createElement('div');
    el.innerHTML = html.trim();
    const card = el.firstChild;
    container.appendChild(card);

    const posValue = card.querySelector('.gallery-pos-value');
    const list = card.querySelector('.gallery-photos-list');

    card.querySelector('.delete-row-btn').addEventListener('click', () => {
        card.remove();
        triggerPreviewUpdate();
    });
    card.querySelector('.gallery-add-photo-btn').addEventListener('click', () => addGalleryPhoto(list, posValue.value));

    if (prefill && prefill.photos) {
        prefill.photos.forEach(p => addGalleryPhoto(list, posValue.value, p));
    } else {
        for (let i = 0; i < 4; i++) {
            addGalleryPhoto(list, posValue.value);
        }
    }
    syncPlacementUI(card);
}

function addGalleryPhoto(list, position, prefill = null) {
    const safePrefillFile = prefill && prefill.file ? prefill.file.replace(/"/g, '&quot;') : '';
    const safePrefillCaption = prefill && prefill.caption ? prefill.caption.replace(/"/g, '&quot;') : '';
    const safePrefillCredit = prefill && prefill.credit ? prefill.credit.replace(/"/g, '&quot;') : '';

    const html = `
        <div class="gallery-photo-entry" style="display:flex; gap:0.75rem; align-items:start; padding: 0.75rem 0; border-bottom: 1px solid var(--editor-border);">
            <div class="media-upload-area" style="width: 70px; height: 70px; border-radius: 6px; border-width: 1px;" title="Upload photo">
                <div class="media-upload-placeholder">${icons.upload}</div>
                <img class="gallery-preview-thumb" src="${safePrefillFile}" style="display: ${safePrefillFile ? 'block' : 'none'};">
                <input type="file" class="image-file-input" accept="image/*">
            </div>
            <div class="media-inputs">
                <div class="media-input-row">
                    <input type="text" name="image_urls[]" class="input-base input-compact gallery-url-input" placeholder="Or URL..." value="${safePrefillFile}" autocomplete="off">
                    <button type="button" class="btn-icon-plain remove-photo-btn" style="height:32px; width:32px;" title="Remove Photo">&times;</button>
                </div>
                <div class="media-input-row">
                    <input type="text" name="image_captions[]" class="input-base input-compact gallery-caption-input" placeholder="Caption" value="${safePrefillCaption}" autocomplete="off">
                    <input type="text" name="image_credits[]" class="input-base input-compact gallery-credit-input" placeholder="Credit" value="${safePrefillCredit}">
                </div>
                <input type="hidden" name="image_placements[]" class="gallery-placement" value="${position}">
                <input type="hidden" name="image_alts[]" value="">
            </div>
        </div>
    `;
    const el = document.createElement('div');
    el.innerHTML = html.trim();
    const entry = el.firstChild;

    list.appendChild(entry);

    const fileInput = entry.querySelector('.image-file-input');
    const urlInput = entry.querySelector('.gallery-url-input');
    const preview = entry.querySelector('.gallery-preview-thumb');
    const uploadPlaceholder = entry.querySelector('.media-upload-placeholder');

    const showPreview = (src) => {
        if (src) { preview.src = src; preview.style.display = 'block'; uploadPlaceholder.style.display = 'none'; }
        else { preview.style.display = 'none'; uploadPlaceholder.style.display = 'flex'; }
        triggerPreviewUpdate();
    };

    fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            const reader = new FileReader();
            reader.onload = e => showPreview(e.target.result);
            reader.readAsDataURL(this.files[0]);
            urlInput.value = '';
        }
    });

    urlInput.addEventListener('input', () => {
        if (urlInput.value) { fileInput.value = ''; showPreview(urlInput.value); }
        else { showPreview(null); }
    });

    const galCaptionInput = entry.querySelector('.gallery-caption-input');
    const galCreditInput = entry.querySelector('.gallery-credit-input');
    setupSmartQuotes(galCaptionInput);
    setupSmartQuotes(galCreditInput);
    galCaptionInput.addEventListener('input', triggerPreviewUpdate);
    galCreditInput.addEventListener('input', triggerPreviewUpdate);

    entry.querySelector('.remove-photo-btn').addEventListener('click', () => {
        entry.remove();
        triggerPreviewUpdate();
    });
}

// ─── Embed Media Card ─────────────────────────────────────────────────────────

function processEmbedCodeForPreview(raw, width, height) {
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

function addEmbed(container, prefill = null) {
    const html = `
        <div class="media-item-card embed-item">
            <div class="media-item-header embed-item-header">
                <span class="media-item-label">Embed</span>
                <button type="button" class="btn-icon-plain delete-row-btn" style="height: 26px; width: 26px;">${icons.trash}</button>
            </div>
            <div class="media-item-body">
                <textarea class="input-base input-compact embed-raw-input" rows="3" style="resize: vertical; font-family: monospace; font-size: 0.8rem;" placeholder="Paste a YouTube link, Spotify URL, or raw HTML embed code..."></textarea>
                <div class="embed-card-preview" style="display: none; border-radius: 6px; overflow: hidden; background: #0f172a; position: relative; min-height: 80px; max-height: 300px;">
                    <iframe class="embed-preview-iframe" frameborder="0" scrolling="no" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups" allowfullscreen style="width: 100%; display: block; border: none; min-height: 80px;"></iframe>
                </div>
                <div class="placement-toolbar" style="background:#f1f5f9; padding:0.5rem; border-radius:6px; margin-bottom: 0.6rem; display:flex; flex-direction:column; gap:0.4rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.7rem; font-weight:700; color:var(--color-text-secondary); text-transform:uppercase; letter-spacing:0.04em;">Align with Block</span>
                        <button type="button" class="btn-icon-plain btn-reset-placement" title="Reset to Top" style="width:20px; height:20px; font-size:14px; color:var(--color-text-secondary);">↺</button>
                    </div>
                    <div style="display:flex; gap:0.25rem; flex-wrap:wrap;">
                        <button type="button" class="btn-tool btn-pick-block" data-align="Left" title="Align Left" style="flex:1; justify-content:center; padding:0 0.25rem; min-width:60px;">◧ Left</button>
                        <button type="button" class="btn-tool btn-pick-block" data-align="Center" title="Place above" style="flex:1; justify-content:center; padding:0 0.25rem; min-width:60px;">■ Center</button>
                        <button type="button" class="btn-tool btn-pick-block" data-align="Right" title="Align Right" style="flex:1; justify-content:center; padding:0 0.25rem; min-width:60px;">◨ Right</button>
                    </div>
                    <input type="hidden" name="embed_placements[]" class="placement-final" value="${prefill?.placement || 'Top Center'}">
                </div>
                <div class="media-input-row" style="gap: 1rem;">
                    <div style="flex: 1; min-width: 0;">
                        <label style="font-size: 0.72rem; font-weight: 600; color: var(--color-text-secondary); display: block; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.04em;">Width</label>
                        <input type="text" name="embed_widths[]" class="input-base input-compact embed-width-input" value="${prefill?.width || '100%'}" placeholder="100% or 560px">
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <label style="font-size: 0.72rem; font-weight: 600; color: var(--color-text-secondary); display: block; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.04em;">Height (px)</label>
                        <input type="number" name="embed_heights[]" class="input-base input-compact embed-height-input" value="${prefill?.height || '560'}" min="100" max="2000">
                    </div>
                </div>
                <input type="hidden" name="embed_codes[]" class="embed-code-hidden" value="">
            </div>
        </div>
    `;

    const el = document.createElement('div');
    el.innerHTML = html.trim();
    const card = el.firstChild;
    container.appendChild(card);

    const rawInput = card.querySelector('.embed-raw-input');
    const hiddenCode = card.querySelector('.embed-code-hidden');
    const previewArea = card.querySelector('.embed-card-preview');
    const previewIframe = card.querySelector('.embed-preview-iframe');
    const widthInput = card.querySelector('.embed-width-input');
    const heightInput = card.querySelector('.embed-height-input');

    const updatePreview = () => {
        const raw = rawInput.value.trim();
        const w = widthInput.value.trim() || '100%';
        const h = heightInput.value || '560';

        hiddenCode.value = raw;

        if (!raw) {
            previewArea.style.display = 'none';
            triggerPreviewUpdate();
            return;
        }

        const processedHtml = processEmbedCodeForPreview(raw, '100%', h);
        if (processedHtml) {
            const iframeHeight = Math.min(parseInt(h, 10) || 560, 280);
            previewIframe.style.height = `${iframeHeight}px`;
            previewArea.style.display = 'block';
            previewIframe.srcdoc = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#000;">${processedHtml}</body></html>`;
        }

        triggerPreviewUpdate();
    };

    rawInput.addEventListener('input', updatePreview);
    widthInput.addEventListener('input', () => { updatePreview(); });
    heightInput.addEventListener('input', () => { updatePreview(); });

    card.querySelector('.delete-row-btn').addEventListener('click', () => {
        card.remove();
        triggerPreviewUpdate();
    });

    if (prefill?.code) {
        rawInput.value = prefill.code;
        updatePreview();
    }
    syncPlacementUI(card);
}

// ─── Status Radios ────────────────────────────────────────────────────────────
function setupStatusRadios(container, isEditing, initialStatus) {
    const radios = container.querySelectorAll('input[name="status_ui"]');
    const statusInput = container.querySelector('#post-status');
    const scheduledRow = container.querySelector('#scheduled-time-row');
    const publishBtn = container.querySelector('#publish-btn');
    const saveDraftBtn = container.querySelector('#save-draft-btn');

    function syncStatus() {
        const val = container.querySelector('input[name="status_ui"]:checked')?.value || 'Published';
        statusInput.value = val;

        container.querySelectorAll('.status-radio-option').forEach(el => {
            el.classList.toggle('selected', el.querySelector('input').checked);
        });

        const isScheduled = val === 'Scheduled';
        scheduledRow.style.display = isScheduled ? 'block' : 'none';

        if (val === 'Published') {
            publishBtn.textContent = isEditing ? 'Update' : 'Publish';
            if (saveDraftBtn) {
                saveDraftBtn.style.display = 'inline-flex';
                saveDraftBtn.textContent = (isEditing && initialStatus === 'Published') ? 'Save Local Draft' : 'Save Draft';
            }
        } else if (val === 'Scheduled') {
            publishBtn.textContent = 'Schedule';
            if (saveDraftBtn) {
                saveDraftBtn.style.display = 'inline-flex';
                saveDraftBtn.textContent = (isEditing && initialStatus === 'Published') ? 'Save Local Draft' : 'Save Draft';
            }
        } else {
            publishBtn.textContent = 'Save Draft';
            if (saveDraftBtn) saveDraftBtn.style.display = 'none';
        }
    }

    radios.forEach(r => r.addEventListener('change', syncStatus));
    syncStatus();
}

// ─── HTML Template ────────────────────────────────────────────────────────────
function createHTML(isEditing, currentStatus) {
    return `
    <div style="display: contents;">
        <form id="create-post-form" class="editor-app-container" novalidate>
            <div class="editor-app-header">
                <div class="app-header-left">
                    <button type="button" class="btn-close-app" id="top-close-btn" title="Back">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    </button>
                    <div class="app-header-title">
                        <h1>${isEditing ? 'Edit Article' : 'New Article'}</h1>
                        <span class="unsaved-dot" id="unsaved-dot" title="Unsaved changes"></span>
                    </div>
                </div>
                <div class="app-header-center">
                    <div class="autosave-status" id="autosave-status"></div>
                    <div class="autosave-banner" id="autosave-banner" style="display:none;">
                        <span class="banner-text"></span>
                        <button type="button" id="autosave-restore" style="display:none;">Restore</button>
                        <button type="button" id="autosave-dismiss">Discard</button>
                    </div>
                </div>
                <div class="app-header-right">
                    <div class="status-indicator">
                        <span class="status-dot status-${currentStatus.toLowerCase()}"></span>
                        <span id="header-status-text">${currentStatus}</span>
                    </div>
                    <button type="button" class="btn-draft" id="save-draft-btn">Save Draft</button>
                    <button type="submit" class="btn-primary-editor" id="publish-btn" data-editing="${isEditing}">${isEditing ? 'Update' : 'Publish'}</button>
                </div>
            </div>

            <div class="editor-app-workspace">

                <!-- Left Pane: Content Editor -->
                <div class="editor-pane-left">
                    <div class="editor-document">

                        <div class="document-meta-row">
                            <select name="category" id="category-select" class="input-clean">
                                <option>Articles</option><option>Community</option><option>Sports</option>
                                <option>Arts</option><option>Opinion</option><option>Editorial</option>
                                <option>Letter to the Editor</option><option>Reviews</option>
                            </select>
                            <input type="text" name="tags" id="post-tags" class="input-clean" placeholder="Tags (comma separated)..." autocomplete="off">
                        </div>

                        <div class="title-wrapper">
                            <span class="title-char-count" id="title-char-count">0 / 120</span>
                            <textarea name="title" id="post-title" class="document-title-input" placeholder="Article Title" rows="1" required maxlength="200" autocomplete="off"></textarea>
                        </div>

                        <div class="document-authors-section">
                            <div id="authors-list" class="authors-grid-clean"></div>
                            <button type="button" class="btn-text-action" id="add-author-btn">+ Add Author</button>
                        </div>

                        <div class="document-desc-section">
                            <div class="content-header">
                                <label>Excerpt / Summary</label>
                                <button type="button" class="btn-tool" id="desc-preview-btn">Preview</button>
                            </div>
                            <textarea name="description" id="post-description" class="document-desc-input" placeholder="Write a short summary shown on article cards..."></textarea>
                            <div class="md-preview desc-preview" id="desc-preview" style="display:none;"></div>
                        </div>

                        <div class="document-content-section" id="content-section">
                            <div class="editor-toolbar-sticky">
                                <div class="content-header">
                                    <label>Article Content</label>
                                    <div class="content-actions">
                                        <button type="button" class="btn-tool" id="content-preview-btn">Preview</button>
                                        <button type="button" class="btn-tool" id="split-view-btn" title="Split View">${icons_svg.split} Split</button>
                                        <button type="button" class="btn-tool fs-btn" id="fullscreen-btn" title="Expand Editor">${icons_svg.enterFs}</button>
                                    </div>
                                </div>
                                ${toolbarHTML('post-content', true)}
                            </div>
                            <div class="content-editor-wrap">
                                <textarea name="content" id="post-content" class="document-content-input" placeholder="Start writing..."></textarea>
                                <div class="md-preview content-preview" id="content-preview" style="display:none; min-height: 500px;"></div>
                            </div>
                            <div class="word-count-display" id="word-count" style="text-align:right; font-size:0.8rem; font-weight:500; color:var(--color-text-secondary); margin-top:8px;">0 words</div>
                        </div>

                        <!-- SEO Section -->
                        <div class="document-seo-section">
                            <div class="content-header"><label>SEO & URL Settings</label></div>
                            <div class="seo-grid">
                                <div>
                                    <label style="font-size:0.8rem; font-weight:600; color:var(--color-dark); display:block; margin-bottom:0.4rem;">URL Slug</label>
                                    <input type="text" name="slug" id="post-slug" class="input-base" placeholder="auto-generated-from-title" autocomplete="off">
                                </div>
                                <div>
                                    <label style="font-size:0.8rem; font-weight:600; color:var(--color-dark); display:block; margin-bottom:0.4rem;">SEO Title</label>
                                    <input type="text" name="seo_title" id="seo-title" class="input-base" placeholder="Override for search engines..." autocomplete="off">
                                </div>
                            </div>
                            <div style="margin-top:1rem;">
                                <label style="font-size:0.8rem; font-weight:600; color:var(--color-dark); display:block; margin-bottom:0.4rem;">SEO Description</label>
                                <textarea name="seo_description" id="seo-description" class="input-base" style="height:auto; min-height:80px; padding:0.75rem; resize:vertical;" placeholder="Meta description (~160 chars)"></textarea>
                            </div>
                        </div>

                    </div>
                </div>

                <!-- Right Pane: Settings & Media -->
                <div class="editor-pane-right" id="editor-right-pane">

                    <!-- Publishing Card -->
                    <div class="right-pane-card">
                        <div class="card-header-row"><h3 class="card-title">Publishing</h3></div>
                        <div class="status-radio-group">
                            <label class="status-radio-option ${currentStatus === 'Published' ? 'selected' : ''}">
                                <input type="radio" name="status_ui" value="Published" ${currentStatus === 'Published' ? 'checked' : ''}>
                                <span>Published</span>
                            </label>
                            <label class="status-radio-option ${currentStatus === 'Unpublished' ? 'selected' : ''}">
                                <input type="radio" name="status_ui" value="Unpublished" ${currentStatus === 'Unpublished' ? 'checked' : ''}>
                                <span>Draft</span>
                            </label>
                            <label class="status-radio-option ${currentStatus === 'Scheduled' ? 'selected' : ''}">
                                <input type="radio" name="status_ui" value="Scheduled" ${currentStatus === 'Scheduled' ? 'checked' : ''}>
                                <span>Scheduled</span>
                            </label>
                        </div>
                        <input type="hidden" name="status" id="post-status" value="${currentStatus}">

                        <div class="date-settings">
                            <label>Publication Date</label>
                            <input type="date" name="date" id="datePicker" class="input-base">
                            <div id="scheduled-time-row" style="display:${currentStatus === 'Scheduled' ? 'block' : 'none'}; margin-top:0.75rem;">
                                <label>Time</label>
                                <input type="time" name="publish_time" id="timePicker" class="input-base">
                            </div>
                        </div>

                        <label class="featured-toggle">
                            <input type="checkbox" id="flag-featured" name="flag_featured" value="true">
                            <div class="featured-toggle-body">
                                <span class="featured-toggle-title">Featured article</span>
                                <span class="featured-toggle-desc">Pin to homepage</span>
                            </div>
                        </label>
                        <label class="featured-toggle">
                            <input type="checkbox" id="comments-disabled" name="comments_disabled" value="true">
                            <div class="featured-toggle-body">
                                <span class="featured-toggle-title">Disable comments</span>
                                <span class="featured-toggle-desc">Close new comments on this article</span>
                            </div>
                        </label>
                    </div>

                    <!-- Media Card -->
                    <div class="right-pane-card">
                        <div class="card-header-row">
                            <h3 class="card-title">Media</h3>
                            <div style="display:flex; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end;">
                                <button type="button" class="btn-text-action" id="add-image-btn">+ Image</button>
                                <button type="button" class="btn-text-action" id="add-gallery-btn">+ Gallery</button>
                                <button type="button" class="btn-text-action" id="add-embed-btn" style="color: #0369a1;">+ Embed</button>
                            </div>
                        </div>
                        <div id="media-list" class="media-list"></div>
                    </div>

                </div>
            </div>
        </form>

        <!-- Table Modal (Hidden by default) -->
        <div id="table-modal" class="user-profile-modal" style="display: none; z-index: 10005;" tabindex="-1">
            <div class="user-profile-drawer" style="max-width: 580px; height: auto; margin: auto; border-radius: 12px; overflow: hidden;">
                <div class="user-profile-header">
                    <h3><span id="table-modal-title">Insert Table</span></h3>
                    <button type="button" class="close-profile-btn" id="close-table-modal">×</button>
                </div>
                <div style="padding: 1.5rem;">
                    <div id="table-dim-row" style="display: flex; gap: 1rem; margin-bottom: 1.25rem;">
                        <div style="flex: 1;">
                            <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.4rem; display: block;">Columns</label>
                            <input type="number" id="table-cols" class="input-base" value="3" min="1" max="8">
                        </div>
                        <div style="flex: 1;">
                            <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.4rem; display: block;">Data Rows</label>
                            <input type="number" id="table-rows" class="input-base" value="2" min="1" max="20">
                        </div>
                    </div>
                    <div style="margin-bottom: 1.5rem;">
                        <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.3rem; display: block;">Table Data</label>
                        <p style="font-size: 0.78rem; color: var(--color-text-secondary); margin: 0 0 0.6rem;">First row = header. Tab / Enter to move between cells.</p>
                        <div id="table-grid-container" style="overflow-x: auto; border: 1px solid var(--editor-border); border-radius: 8px;"></div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
                        <button type="button" class="button-secondary" id="cancel-table-modal">Cancel</button>
                        <button type="button" class="button-primary" id="insert-table-btn">Insert Table</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Embed Modal (Hidden by default) -->
        <div id="embed-modal" class="user-profile-modal" style="display: none; z-index: 10005;" tabindex="-1">
            <div class="user-profile-drawer" style="max-width: 500px; height: auto; margin: auto; border-radius: 12px; overflow: hidden;">
                <div class="user-profile-header">
                    <h3>Insert Embed</h3>
                    <button type="button" class="close-profile-btn" id="close-embed-modal">×</button>
                </div>
                <div style="padding: 1.5rem;">
                    <p style="font-size: 0.85rem; color: var(--color-text-secondary); margin-bottom: 1.5rem; line-height: 1.5;">
                        Tip: Place your cursor inside an existing embed block before clicking the toolbar button to edit its properties.
                    </p>
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem; display: block;">URL or Embed Code</label>
                        <textarea id="embed-input-code" class="input-base" style="height: 100px; resize: vertical; padding: 0.75rem;" placeholder="Paste a YouTube/Spotify link, or raw HTML embed code..."></textarea>
                    </div>
                    <div class="form-group" style="margin-bottom: 1.5rem;">
                        <label style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem; display: block;">Height (px)</label>
                        <input type="number" id="embed-input-height" class="input-base" value="700" min="100" max="2000">
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
                        <button type="button" class="button-secondary" id="cancel-embed-modal">Cancel</button>
                        <button type="button" class="button-primary" id="insert-embed-btn">Insert</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
}

// ─── Listeners & Initialization ───────────────────────────────────────────────
function attachListeners(container, isEditing, articleId, initialStatus) {
    const form = container.querySelector('#create-post-form');

    // Status setup
    setupStatusRadios(container, isEditing, initialStatus);
    container.querySelectorAll('input[name="status_ui"]').forEach(r => {
        r.addEventListener('change', (e) => {
            const txt = document.getElementById('header-status-text');
            const dot = document.querySelector('.status-dot');
            if (txt) txt.textContent = e.target.value;
            if (dot) dot.className = `status-dot status-${e.target.value.toLowerCase()}`;
        });
    });

    // Close logic
    container.querySelector('#top-close-btn').addEventListener('click', () => {
        if (hasUnsavedChanges() && !confirm('Discard unsaved changes?')) return;
        navigate('/account');
    });

    // Title / Slug / Textareas auto-resize
    const titleInput = container.querySelector('#post-title');
    const charCount = container.querySelector('#title-char-count');
    const slugInput = container.querySelector('#post-slug');
    let slugEdited = !!slugInput.value;

    const autoResize = (el) => {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    };

    [titleInput,
     container.querySelector('#post-description'),
     container.querySelector('#post-content'),
     container.querySelector('#seo-title'),
     container.querySelector('#seo-description'),
     container.querySelector('#post-tags')
    ].forEach(el => { if (el) setupSmartQuotes(el); });

    titleInput.addEventListener('input', function() {
        autoResize(this);
        charCount.textContent = `${this.value.length} / 120`;
        charCount.classList.toggle('char-count-warn', this.value.length > 100);
        charCount.classList.toggle('char-count-danger', this.value.length > 120);
        if (!slugEdited) slugInput.value = titleToSlug(this.value);
        updateUnsavedDot();
    });

    slugInput.addEventListener('input', () => { slugEdited = true; });

    const descInput = container.querySelector('#post-description');
    descInput.addEventListener('input', function() { autoResize(this); updateUnsavedDot(); });

    const contentInput = container.querySelector('#post-content');
    const wordCount = container.querySelector('#word-count');
    contentInput.addEventListener('input', function() {
        const words = this.value.trim() ? this.value.trim().split(/\s+/).length : 0;
        wordCount.textContent = `${words.toLocaleString()} words · ~${Math.ceil(words/250)} min read`;
        updateUnsavedDot();
    });

    // Toolbars & features
    container.querySelectorAll('.md-toolbar').forEach(setupToolbar);
    container.querySelectorAll('.md-toolbar').forEach(tb => {
        const ta = document.getElementById(tb.dataset.target);
        if (ta) setupTextareaShortcuts(ta);
    });
    setupPreviewToggle(container.querySelector('#desc-preview-btn'), descInput, container.querySelector('#desc-preview'), true);
    const previewControls = setupPreviewToggle(container.querySelector('#content-preview-btn'), contentInput, container.querySelector('#content-preview'), false);
    const splitControls = setupSplitView(container.querySelector('#split-view-btn'), contentInput, container.querySelector('#content-preview'), container.querySelector('#content-section'));

    previewControls.onActivate = () => splitControls.exit();
    splitControls.onActivate = () => previewControls.exit();
    setupFullscreen(container.querySelector('#fullscreen-btn'));
    setupEmbedModal();
    setupTableModal();

    // Preview table: floating "Edit structure" button + inline cell editing
    const previewPaneEl = container.querySelector('#content-preview');
    previewPaneEl.style.position = 'relative';

    const tblStructBtn = document.createElement('button');
    tblStructBtn.type = 'button';
    tblStructBtn.className = 'preview-table-struct-btn';
    tblStructBtn.textContent = '⊞ Edit structure';
    previewPaneEl.appendChild(tblStructBtn);

    let _hoveredTable = null;

    const positionStructBtn = (tableEl) => {
        const previewRect = previewPaneEl.getBoundingClientRect();
        const tableRect   = tableEl.getBoundingClientRect();
        tblStructBtn.style.top  = `${tableRect.top - previewRect.top + previewPaneEl.scrollTop - 30}px`;
        tblStructBtn.style.right = '0px';
    };

    previewPaneEl.addEventListener('mouseover', e => {
        if (previewPaneEl.classList.contains('picker-mode-active')) return;
        const tableEl = e.target.closest('table');
        if (tableEl === _hoveredTable) return;
        _hoveredTable = tableEl;
        if (tableEl) {
            positionStructBtn(tableEl);
            tblStructBtn.style.display = 'block';
        } else if (!tblStructBtn.matches(':hover')) {
            tblStructBtn.style.display = 'none';
        }
    });

    previewPaneEl.addEventListener('mouseleave', () => {
        _hoveredTable = null;
        if (!tblStructBtn.matches(':hover')) tblStructBtn.style.display = 'none';
    });

    tblStructBtn.addEventListener('mouseleave', () => {
        if (!_hoveredTable) tblStructBtn.style.display = 'none';
    });

    tblStructBtn.addEventListener('click', e => {
        e.stopPropagation();
        const tableEl = _hoveredTable;
        if (!tableEl) return;
        const allTables   = Array.from(previewPaneEl.querySelectorAll('table'));
        const tableIndex  = allTables.indexOf(tableEl);
        if (tableIndex === -1) return;
        const allMdTables = findAllMarkdownTables(contentInput.value);
        const mdTable = allMdTables[tableIndex];
        if (!mdTable) return;
        const parsed = parseMarkdownTable(mdTable.text);
        if (!parsed) return;
        openTableModal(contentInput, mdTable, parsed);
        tblStructBtn.style.display = 'none';
    });

    previewPaneEl.addEventListener('click', e => {
        if (previewPaneEl.classList.contains('picker-mode-active')) return;
        if (tblStructBtn.contains(e.target)) return;

        const cellEl = e.target.closest('td, th');
        if (!cellEl) return;
        if (cellEl.contentEditable === 'true') return;

        e.preventDefault();
        e.stopPropagation();

        const tableEl = cellEl.closest('table');
        if (!tableEl) return;

        const allTables   = Array.from(previewPaneEl.querySelectorAll('table'));
        const tableIndex  = allTables.indexOf(tableEl);
        if (tableIndex === -1) return;
        const allMdTables = findAllMarkdownTables(contentInput.value);
        const mdTable = allMdTables[tableIndex];
        if (!mdTable) return;
        const parsed = parseMarkdownTable(mdTable.text);
        if (!parsed) return;
        openTableModal(contentInput, mdTable, parsed);
        tblStructBtn.style.display = 'none';
    });

    previewPaneEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (previewPaneEl.classList.contains('picker-mode-active')) return;
        if (tblStructBtn.contains(e.target)) return;

        const cellEl = e.target.closest('td, th');
        if (!cellEl) return;
        const tableEl = cellEl.closest('table');
        if (!tableEl) return;

        e.preventDefault();
        e.stopPropagation();
        if (cellEl.contentEditable === 'true') return;

        const originalText = cellEl.textContent.trim();

        if (!originalText) {
            cellEl.innerHTML = '<br>';
        }

        cellEl.contentEditable = 'true';
        cellEl.classList.add('cell-editing');
        cellEl.focus();

        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(cellEl);
        sel.removeAllRanges();
        sel.addRange(range);

        const commitEdit = (nextCell) => {
            if (cellEl.contentEditable !== 'true') return;
            cellEl.contentEditable = 'false';
            cellEl.classList.remove('cell-editing');

            const allTables   = Array.from(previewPaneEl.querySelectorAll('table'));
            const tableIndex  = allTables.indexOf(tableEl);
            if (tableIndex === -1) return;
            const allMdTables = findAllMarkdownTables(contentInput.value);
            const mdTable = allMdTables[tableIndex];
            if (!mdTable) return;

            const newMd = tableToMarkdown(tableEl);
            contentInput.value = contentInput.value.substring(0, mdTable.start) + newMd + contentInput.value.substring(mdTable.end);
            contentInput.dispatchEvent(new Event('input'));

            if (nextCell) {
                const newTables = Array.from(previewPaneEl.querySelectorAll('table'));
                const newTable  = newTables[tableIndex];
                if (newTable) {
                    const newRow = newTable.rows[nextCell.rowIndex];
                    const newCell = newRow && newRow.cells[nextCell.colIndex];
                    if (newCell) newCell.click();
                }
            }
        };

        const cancelEdit = () => {
            cellEl.contentEditable = 'false';
            cellEl.classList.remove('cell-editing');
            cellEl.textContent = originalText;
        };

        let committed = false;

        const onKeyDown = kEvt => {
            if (kEvt.key === 'Enter') {
                kEvt.preventDefault();
                if (committed) return; committed = true;
                cellEl.removeEventListener('keydown', onKeyDown);
                cellEl.removeEventListener('blur', onBlur);
                const nextRowIndex = cellEl.parentElement.rowIndex + 1;
                const colIndex     = cellEl.cellIndex;
                commitEdit({ rowIndex: nextRowIndex, colIndex });
            } else if (kEvt.key === 'Tab') {
                kEvt.preventDefault();
                if (committed) return; committed = true;
                cellEl.removeEventListener('keydown', onKeyDown);
                cellEl.removeEventListener('blur', onBlur);
                const cells    = Array.from(tableEl.querySelectorAll('td, th'));
                const idx      = cells.indexOf(cellEl);
                const nextCellEl = cells[kEvt.shiftKey ? idx - 1 : idx + 1];
                const nextPos  = nextCellEl
                    ? { rowIndex: nextCellEl.parentElement.rowIndex, colIndex: nextCellEl.cellIndex }
                    : null;
                commitEdit(nextPos);
            } else if (kEvt.key === 'Escape') {
                cellEl.removeEventListener('keydown', onKeyDown);
                cellEl.removeEventListener('blur', onBlur);
                cancelEdit();
            }
        };

        const onBlur = () => {
            cellEl.removeEventListener('keydown', onKeyDown);
            if (!committed) { committed = true; commitEdit(null); }
        };

        cellEl.addEventListener('keydown', onKeyDown);
        cellEl.addEventListener('blur', onBlur, { once: true });
    });

    const catSelect = container.querySelector('#category-select');
    const authList = container.querySelector('#authors-list');
    const addAuthBtn = container.querySelector('#add-author-btn');
    catSelect.addEventListener('change', () => {
        if (catSelect.value === 'Editorial') {
            authList.innerHTML = '';
            addAuthor(authList, { name: 'ANDOVERVIEW', role: 'Editorial Board', locked: true });
            addAuthBtn.style.display = 'none';
        } else {
            if (authList.querySelector('.name-final-value')?.value === 'ANDOVERVIEW') {
                authList.innerHTML = ''; addAuthor(authList);
            }
            addAuthBtn.style.display = 'inline-flex';
        }
    });

    addAuthBtn.addEventListener('click', () => addAuthor(authList));
    container.querySelector('#add-image-btn').addEventListener('click', () => addImage(container.querySelector('#media-list')));
    container.querySelector('#add-gallery-btn').addEventListener('click', () => addGallery(container.querySelector('#media-list')));
    container.querySelector('#add-embed-btn').addEventListener('click', () => addEmbed(container.querySelector('#media-list')));

    container.querySelector('#save-draft-btn').addEventListener('click', async () => {
        if (isEditing && initialStatus === 'Published') {
            await performAutosave(true);
            initialFormState = getFormSnapshot();
            updateUnsavedDot();
            showSuccess('Draft saved! The live article remains unchanged.');
        } else {
            container.querySelector('input[name="status_ui"][value="Unpublished"]').checked = true;
            setupStatusRadios(container, isEditing, initialStatus);
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const titleInput = form.querySelector('#post-title');
        if (!titleInput.value.trim()) {
            showWarning('Article title is required.');
            titleInput.focus();
            return;
        }

        const btn = container.querySelector('#publish-btn');
        const origText = btn.textContent;
        btn.disabled = true; btn.textContent = 'Saving...';

        let i = 0;
        form.querySelectorAll('.image-file-input').forEach(inp => {
            inp.name = `image_${i++}`;
        });

        const formData = new FormData(form);

        formData.delete('author_names[]'); formData.delete('author_roles[]');
        form.querySelectorAll('.name-final-value').forEach(el => { if (el.value.trim()) formData.append('author_names[]', el.value.trim()); });
        form.querySelectorAll('.role-final-value').forEach(el => formData.append('author_roles[]', el.value.trim()));

        try {
            const res = isEditing ? await updateArticle(articleId, formData) : await createArticle(formData);
            if (res.success) {
                initialFormState = getFormSnapshot();
                await clearAutosave(); updateUnsavedDot();
                showSuccess('Article saved!');
                setTimeout(() => { navigate(`/article/${res.articleId}`); document.body.classList.remove('has-editor-open'); }, 1000);
            } else {
                showError(res.error || 'Failed to save.');
                btn.disabled = false; btn.textContent = origText;
            }
        } catch (err) {
            showError('Network error.');
            btn.disabled = false; btn.textContent = origText;
        }
    });

    if (autosaveTimer) clearInterval(autosaveTimer);
    autosaveTimer = setInterval(() => performAutosave(false), 60000);
    let autoSaveDeb;
    container.addEventListener('input', () => {
        clearTimeout(autoSaveDeb);
        autoSaveDeb = setTimeout(() => performAutosave(false), 1000);
    });

    const kbShort = e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { 
            e.preventDefault(); 
            form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true})); 
        }
        if (e.key === 'Escape') {
            const embedModal = document.getElementById('embed-modal');
            if (embedModal && embedModal.style.display === 'flex') embedModal.style.display = 'none';
            const tableModal = document.getElementById('table-modal');
            if (tableModal && tableModal.style.display === 'flex') tableModal.style.display = 'none';
            exitPickerMode();
        }
    };
    document.addEventListener('keydown', kbShort);

    // --- VISUAL BLOCK PICKER LOGIC ---
    let activePickerAlign = null;
    let activePickerBtn = null;
    let activePickerInput = null;
    const previewEl = container.querySelector('#content-preview');

    const exitPickerMode = () => {
        if (activePickerBtn) activePickerBtn.classList.remove('active-picking');
        previewEl.classList.remove('picker-mode-active');
        activePickerBtn = null;
        activePickerInput = null;
        activePickerAlign = null;
    };

    container.addEventListener('click', (e) => {
        const pickBtn = e.target.closest('.btn-pick-block');
        if (pickBtn) {
            e.preventDefault();
            if (activePickerBtn === pickBtn && previewEl.classList.contains('picker-mode-active')) {
                exitPickerMode();
                return;
            }
            exitPickerMode();

            activePickerBtn = pickBtn;
            activePickerAlign = pickBtn.dataset.align;
            activePickerInput = pickBtn.closest('.media-item-card').querySelector('.placement-final, .gallery-pos-value');

            pickBtn.classList.add('active-picking');
            previewEl.classList.add('picker-mode-active');

            if (previewEl.style.display === 'none') {
                container.querySelector('#content-preview-btn').click();
            }
            previewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        const resetBtn = e.target.closest('.btn-reset-placement');
        if (resetBtn) {
            e.preventDefault();
            const card = resetBtn.closest('.media-item-card');
            const input = card.querySelector('.placement-final, .gallery-pos-value');
            if (input) {
                input.value = input.classList.contains('gallery-pos-value') ? 'Gallery Top' : 'Top Center';

                if (input.classList.contains('gallery-pos-value')) {
                    card.querySelectorAll('.gallery-placement').forEach(i => i.value = 'Gallery Top');
                }

                syncPlacementUI(card);
                triggerPreviewUpdate();
            }
            return;
        }

        if (activePickerInput && previewEl.contains(e.target)) {
            e.preventDefault();
            e.stopPropagation();

            const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'PRE', 'TABLE', 'DIV', 'FIGURE'];
            let targetBlock = e.target;

            while (targetBlock && targetBlock !== previewEl) {
                if (blockTags.includes(targetBlock.tagName)) break;
                targetBlock = targetBlock.parentElement;
            }

            if (targetBlock && targetBlock !== previewEl) {
                const contentWrapper = previewEl.querySelector('.single-article-content');
                if (contentWrapper) {
                    const textBlockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'PRE', 'TABLE', 'DIV'];
                    const allChildren = Array.from(contentWrapper.children);
                    const textBlocks = allChildren.filter(el => {
                        if (!textBlockTags.includes(el.tagName)) return false;
                        return el.textContent.trim().length > 0 || el.tagName === 'DIV' || el.tagName === 'TABLE';
                    });

                    let index;
                    if (targetBlock.tagName === 'FIGURE') {
                        const figChildIdx = allChildren.indexOf(targetBlock);
                        const preceding = textBlocks.filter(el => allChildren.indexOf(el) < figChildIdx);
                        index = Math.max(1, preceding.length);
                    } else {
                        index = textBlocks.indexOf(targetBlock) + 1;
                    }

                    if (index > 0) {
                        const newVal = activePickerAlign === 'Gallery Custom' 
                            ? `Gallery Custom ${index}` 
                            : `Custom ${activePickerAlign} ${index}`;

                        activePickerInput.value = newVal;

                        if (activePickerAlign === 'Gallery Custom') {
                            const card = activePickerInput.closest('.media-item-card');
                            card.querySelectorAll('.gallery-placement').forEach(i => i.value = newVal);
                        }

                        if (activePickerAlign === 'Left' || activePickerAlign === 'Right') {
                            const opposite = activePickerAlign === 'Left' ? 'Right' : 'Left';
                            container.querySelectorAll('.placement-final').forEach(otherInput => {
                                if (otherInput === activePickerInput) return;
                                const otherVal = otherInput.value || '';
                                const otherMatch = otherVal.match(/^Custom (Left|Center|Right) (\d+)$/i);
                                if (!otherMatch) return;
                                const otherAlign = otherMatch[1];
                                const otherIndex = parseInt(otherMatch[2], 10);
                                if (otherIndex !== index) return;
                                if (otherAlign === activePickerAlign || otherAlign === 'Center') {
                                    otherInput.value = `Custom ${opposite} ${index}`;
                                    const otherCard = otherInput.closest('.media-item-card');
                                    if (otherCard) syncPlacementUI(otherCard);
                                }
                            });
                        }

                        const card = activePickerBtn.closest('.media-item-card');
                        syncPlacementUI(card);
                        triggerPreviewUpdate();
                    }
                }
            }
            exitPickerMode();
        }
    });

    return () => { 
        document.removeEventListener('keydown', kbShort); 
        clearInterval(autosaveTimer); 
        clearTimeout(autoSaveDeb); 
        document.body.classList.remove('has-editor-open'); 
    };
}

export async function render(container, articleId = null) {
    savedTableModalState = null; 
    document.body.classList.add('has-editor-open');
    await loadStaffData();

    currentArticleId = articleId;
    const isEditing = !!articleId;
    let currentStatus = 'Published';
    let article = null;

    if (isEditing) {
        article = await getAdminFullArticle(articleId);
        if (!article) { showError('Article not found.'); navigate('/account'); return; }
        currentStatus = article.status || 'Published';
    }

    container.innerHTML = createHTML(isEditing, currentStatus);

    if (isEditing && article) {
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setVal('post-title', article.title);
        setVal('category-select', article.category);
        setVal('post-tags', article.tags ? article.tags.join(', ') : '');
        setVal('datePicker', article.date ? new Date(article.date).toISOString().split('T')[0] : '');
        setVal('post-description', article.rawDescription || article.description);
        setVal('post-content', article.rawContent || article.content);
        setVal('post-slug', article.slug);
        setVal('seo-title', article.seoTitle);
        setVal('seo-description', article.seoDescription);
        if (article.featured) document.getElementById('flag-featured').checked = true;
        if (article.comments_disabled) document.getElementById('comments-disabled').checked = true;

        if (article.category === 'Editorial') {
            document.getElementById('category-select').dispatchEvent(new Event('change'));
        } else {
            const authList = document.getElementById('authors-list');
            if (article.writers?.length) article.writers.forEach(w => addAuthor(authList, w));
            else addAuthor(authList);
        }

        const mediaList = document.getElementById('media-list');
        if (article.images?.length) {
            const sorted = [...article.images].sort((a, b) => placementSortKey(a.placement) - placementSortKey(b.placement));
            sorted.forEach(img => {
                if (img.placement?.startsWith('Gallery')) {
                    let group = Array.from(mediaList.children).find(c => c.classList.contains('gallery-group-item') && c.querySelector('.gallery-pos-value').value === img.placement);
                    if (!group) { addGallery(mediaList, { position: img.placement, photos: [img] }); }
                    else { addGalleryPhoto(group.querySelector('.gallery-photos-list'), img.placement, img); }
                } else {
                    addImage(mediaList, img);
                }
            });
        }
        if (article.embeds?.length) {
            article.embeds.forEach(emb => addEmbed(mediaList, emb));
        }

        document.getElementById('post-title').dispatchEvent(new Event('input'));
        document.getElementById('post-description').dispatchEvent(new Event('input'));
        document.getElementById('post-content').dispatchEvent(new Event('input'));
    } else {
        addAuthor(document.getElementById('authors-list'));
        addImage(document.getElementById('media-list'));
        document.getElementById('datePicker').value = new Date().toISOString().split('T')[0];
    }

    const cleanup = attachListeners(container, isEditing, articleId, currentStatus);

    const autosaveData = await checkAutosave(articleId);
    if (autosaveData) {
        restoreAutosave(autosaveData);
        showAutosaveBanner(autosaveData);
    }

    initialFormStateTimer = setTimeout(() => { initialFormState = getFormSnapshot(); }, 200);

    return () => {
        clearTimeout(initialFormStateTimer);
        cleanup();
    };
}