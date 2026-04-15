import { apiFetch } from './csrf.js';
import { toRootRelativePath } from './paths.js';

let cachedList = null;
let cacheGeneration = 0; 
let fetchPromise = null; 

// --- LOCAL STORAGE CACHE HELPERS ---
const CACHE_PREFIX = 'ahsv2_';
const CACHE_EXPIRY = 1000 * 60 * 5; 

let storageAvailable = false;
try {
    const probe = '__ahsv2_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    storageAvailable = true;
} catch (e) {
    console.warn('[api] localStorage unavailable — in-memory cache only. Offline reading and stale-while-revalidate will not persist across page loads.');
}

function getFromStorage(key) {
    if (!storageAvailable) return null;
    try {
        const item = localStorage.getItem(CACHE_PREFIX + key);
        if (!item) return null;
        const record = JSON.parse(item);
        if (Date.now() > record.expiry) {
            localStorage.removeItem(CACHE_PREFIX + key);
            return null;
        }
        return record.data;
    } catch (e) {
        try { localStorage.removeItem(CACHE_PREFIX + key); } catch (_) {}
        return null;
    }
}

function saveToStorage(key, data) {
    if (!storageAvailable) return;
    const record = { data: data, expiry: Date.now() + CACHE_EXPIRY };
    const stringified = JSON.stringify(record);

    try {
        localStorage.setItem(CACHE_PREFIX + key, stringified);
    } catch (e) {
        let clearedSpace = false;
        Object.keys(localStorage).forEach(existingKey => {
            if (existingKey.startsWith(CACHE_PREFIX)) {
                localStorage.removeItem(existingKey);
                clearedSpace = true;
            }
        });

        if (clearedSpace) {
            try {
                localStorage.setItem(CACHE_PREFIX + key, stringified);
            } catch (err) {
                console.warn('[api] Storage quota exceeded even after cleanup.');
            }
        } else {
            console.warn('[api] Storage quota exceeded — cache entry not saved.');
        }
    }
}

function waitForMarked() {
    if (typeof marked !== 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (typeof marked !== 'undefined') {
                clearInterval(interval);
                resolve();
            }
        }, 20);
    });
}

// Marked extension: Custom Image Renderer and Embed Extension
export function registerEmbedExtension() {
    if (marked._embedExtensionRegistered) return;

    marked.use({
        renderer: {
            // Override standard markdown images ![alt](url "title") to use the site's rich figure styling
            image(href, title, text) {
                let actualHref = href, actualTitle = title, actualText = text;
                if (typeof href === 'object' && href !== null) {
                    actualHref = href.href;
                    actualTitle = href.title;
                    actualText = href.text;
                }

                const altAttr = actualText ? ` alt="${actualText}"` : ' alt="Article image"';

                // Construct the caption block using text as Caption and title as Credit
                let captionHtml = '';
                if (actualText || actualTitle) {
                    captionHtml = `<figcaption>`;
                    if (actualText) captionHtml += `<span class="caption-text">${actualText}</span>`;
                    if (actualTitle) captionHtml += `<span class="caption-credit">${actualTitle}</span>`;
                    captionHtml += `</figcaption>`;
                }

                return `</p>
                    <figure class="single-article-figure placement--custom-center">
                        <img src="${toRootRelativePath(actualHref)}"${altAttr} class="single-article-image">
                        ${captionHtml}
                    </figure>
                <p>`; // Break out of paragraph wrappers to avoid invalid HTML nesting
            }
        },
        extensions: [{
            name: 'embed',
            level: 'block',
            start(src) { return src.indexOf('```embed'); },
            tokenizer(src) {
                const match = src.match(/^```embed\n([\s\S]*?)```(?:\n|$)/);
                if (match) {
                    return { type: 'embed', raw: match[0], embedHtml: match[1].trim() };
                }
            },
            renderer(token) {
                return `<div class="embed-container">${token.embedHtml}</div>\n`;
            }
        }]
    });
    marked._embedExtensionRegistered = true;
}

// Pre-processing helper
async function processArticleContent(article) {
    if (!article._processed) {
        await waitForMarked();
        marked.setOptions({ mangle: false, headerIds: false });
        registerEmbedExtension();
        article.rawContent = article.content;
        article.description = marked.parseInline(article.rawDescription || '');
        article.content = marked.parse(article.content || '');
        article._processed = true;
    }
    return article;
}

export function invalidateCache() {
    cacheGeneration++; 
    cachedList = null;
    fetchPromise = null;
    if (storageAvailable) {
        try {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
            });
        } catch (e) { }
    }
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
    }
}

export function getCachedSingleArticle(id) {
    return getFromStorage(`article_${id}`) || null;
}

export function getCachedArticleList() {
    const data = getFromStorage('article_list');
    if (data && data.articles) {
        return data;
    }
    return null;
}

export async function getCombinedData() {
    if (cachedList) return cachedList;

    const stored = getCachedArticleList();
    if (stored) {
        cachedList = stored;
        if (!fetchPromise) {
            const capturedGeneration = cacheGeneration;
            fetchPromise = fetch('/api/articles')
                .then(r => (r.ok ? r.json() : null))
                .then(async data => {
                    if (!data) return;
                    await waitForMarked();
                    marked.setOptions({ mangle: false, headerIds: false });
                    data.articles.forEach(article => {
                        article.description = marked.parseInline(article.rawDescription || '');
                    });
                    if (capturedGeneration !== cacheGeneration) return;
                    cachedList = data;
                    saveToStorage('article_list', data);
                })
                .catch(() => {})
                .finally(() => { fetchPromise = null; });
        }
        return cachedList;
    }

    if (fetchPromise) return fetchPromise;

    const capturedGeneration = cacheGeneration;
    fetchPromise = (async () => {
        try {
            const response = await fetch('/api/articles');
            if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`);
            const data = await response.json();

            await waitForMarked();
            marked.setOptions({ mangle: false, headerIds: false });
            data.articles.forEach(article => {
                article.description = marked.parseInline(article.rawDescription || '');
            });

            if (capturedGeneration !== cacheGeneration) {
                console.warn('[api] getCombinedData: discarding stale fetch (cache invalidated during flight)');
                return null;
            }
            cachedList = data;
            saveToStorage('article_list', data);
            return data;
        } catch (error) {
            console.error("Could not fetch data:", error);
            return { articles: [], staff: [] };
        } finally {
            fetchPromise = null;
        }
    })();

    return fetchPromise;
}

export async function getSingleArticle(id) {
    const capturedGeneration = cacheGeneration;
    try {
        const response = await fetch(`/api/articles/${id}`);
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error('Failed to fetch article');
        }
        const article = await response.json();
        const processed = await processArticleContent(article);

        if (capturedGeneration === cacheGeneration) {
            saveToStorage(`article_${id}`, processed);
        }
        return processed;
    } catch (error) {
        console.error('Error fetching single article:', error);
        return getCachedSingleArticle(id); 
    }
}

export async function getArticlePage(page = 1, limit = 20) {
    try {
        const response = await fetch(`/api/articles?page=${page}&limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch articles page');
        const data = await response.json();
        await waitForMarked();
        marked.setOptions({ mangle: false, headerIds: false });
        data.articles.forEach(article => {
            article.description = marked.parseInline(article.rawDescription || '');
        });
        return data;
    } catch (error) {
        console.error('Error fetching article page:', error);
        return { articles: [], staff: [], total: 0, hasMore: false };
    }
}

export async function getArticleRecommendations(id) {
    try {
        const response = await fetch(`/api/articles/${id}/recommendations`);
        if (!response.ok) throw new Error('Failed to fetch recommendations');
        return await response.json();
    } catch (error) {
        console.error('Error fetching recommendations:', error);
        return [];
    }
}

export async function performSearch(query) {
    try {
        const response = await fetch(`/api/articles/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Search failed');
        const results = await response.json();
        return results;
    } catch (error) {
        console.error('Search error:', error);
        return [];
    }
}

export async function getAdminFullArticle(id) {
    try {
        const response = await fetch(`/api/admin/articles/${id}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Article not found or access denied');
        const article = await response.json();
        return await processArticleContent(article);
    } catch (error) {
        console.error('Error fetching admin article:', error);
        return null;
    }
}

export async function changeUsername(newUsername) {
    try {
        const response = await apiFetch('/api/users/username', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newUsername }),
        });
        const data = await response.json();
        if (!response.ok) return { success: false, error: data.error };
        return { success: true, user: data.user };
    } catch (error) {
        return { success: false, error: 'Could not connect to the server.' };
    }
}

export async function changePassword(currentPassword, newPassword) {
    try {
        const response = await apiFetch('/api/users/password', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await response.json();
        if (!response.ok) return { success: false, error: data.error };
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Could not connect to the server.' };
    }
}

export async function changeEmail(newEmail) {
    try {
        const response = await apiFetch('/api/users/email', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newEmail }),
        });
        const data = await response.json();
        if (!response.ok) return { success: false, error: data.error };
        return { success: true, user: data.user };
    } catch (error) {
        return { success: false, error: 'Could not connect to the server.' };
    }
}

export async function likeArticle(articleId, isLiking = true) {
    try {
        const response = await apiFetch(`/api/articles/${articleId}/like`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: isLiking ? 'like' : 'unlike' }),
        });
        if (!response.ok) throw new Error('Like request failed');
        const result = await response.json();

        const cached = getCachedSingleArticle(articleId);
        if (cached) {
            cached.likes = result.likes;
            cached.user_has_liked = result.user_has_liked;
            saveToStorage(`article_${articleId}`, cached);
        }
        return result;
    } catch (error) {
        console.error('Failed to like/unlike article:', error);
        return null;
    }
}

export async function bookmarkArticle(articleId, isBookmarking = true) {
    try {
        const response = await apiFetch(`/api/articles/${articleId}/bookmark`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: isBookmarking ? 'bookmark' : 'unbookmark' }),
        });
        if (!response.ok) throw new Error('Bookmark request failed');
        const result = await response.json();

        const cached = getCachedSingleArticle(articleId);
        if (cached) {
            cached.user_has_bookmarked = result.user_has_bookmarked;
            saveToStorage(`article_${articleId}`, cached);
        }
        return result;
    } catch (error) {
        console.error('Failed to bookmark/unbookmark article:', error);
        return null;
    }
}

export async function getComments(articleId) {
    try {
        const response = await fetch(`/api/articles/${articleId}/comments`);
        if (!response.ok) throw new Error('Failed to fetch comments');
        return await response.json();
    } catch (error) {
        console.error('Error fetching comments:', error);
        return [];
    }
}

export async function postComment(articleId, content) {
    try {
        const response = await apiFetch(`/api/articles/${articleId}/comments`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to post comment');
        }
        return await response.json();
    } catch (error) {
        console.error('Error posting comment:', error);
        return { error: error.message };
    }
}

export async function editComment(commentId, content) {
    try {
        const response = await apiFetch(`/api/comments/${commentId}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        if (!response.ok) throw new Error('Failed to edit comment');
        return await response.json();
    } catch (error) {
        console.error('Error editing comment:', error);
        return null;
    }
}

export async function deleteComment(commentId) {
    try {
        const response = await apiFetch(`/api/comments/${commentId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!response.ok) throw new Error('Failed to delete comment');
        return await response.json();
    } catch (error) {
        console.error('Error deleting comment:', error);
        return null;
    }
}

export async function getAccountData() {
    try {
        const response = await fetch('/api/account/data', { credentials: 'include' });
        if (response.status === 401) return { error: 'Unauthorized' };
        if (!response.ok) throw new Error('Failed to fetch account data');
        return await response.json();
    } catch (error) {
        console.error('Error fetching account data:', error);
        return null;
    }
}

export async function trackArticleView(articleId) {
    try {
        const response = await apiFetch(`/api/articles/${articleId}/view`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) throw new Error('Failed to track article view');
        return await response.json();
    } catch (error) {
        console.error('Error tracking article view:', error);
        return null;
    }
}

export async function deleteAccount() {
    try {
        const response = await apiFetch('/api/account/', {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!response.ok) throw new Error('Failed to delete account');
        return await response.json();
    } catch (error) {
        console.error('Error deleting account:', error);
        return null;
    }
}

export async function getAdminStats() {
    try {
        const response = await fetch('/api/admin/stats', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch admin stats');
        return await response.json();
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        return null;
    }
}

export async function getAdminUsers() {
    try {
        const response = await fetch('/api/admin/users', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch users');
        return await response.json();
    } catch (error) {
        console.error('Error fetching users:', error);
        return [];
    }
}

export async function deleteUserByAdmin(userId) {
    try {
        const response = await apiFetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete user');
        }
        return await response.json();
    } catch (error) {
        console.error('Error deleting user:', error);
        return { error: error.message };
    }
}

export async function getAdminArticles() {
    try {
        const response = await fetch('/api/admin/articles', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch article analytics');
        return await response.json();
    } catch (error) {
        console.error('Error fetching article analytics:', error);
        return [];
    }
}

export async function getRecentCommentsAdmin(limit = 50) {
    try {
        const response = await fetch(`/api/admin/comments/recent?limit=${limit}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch recent comments');
        return await response.json();
    } catch (error) {
        console.error('Error fetching recent comments:', error);
        return [];
    }
}

export async function getAdminDashboard() {
    try {
        const response = await fetch('/api/admin/dashboard', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch dashboard data');
        return await response.json();
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        return null;
    }
}

export async function getUserProfile(userId) {
    try {
        const response = await fetch(`/api/admin/users/${userId}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch user profile');
        return await response.json();
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
}

export async function getUserActivity(userId, limit = 50, offset = 0) {
    try {
        const response = await fetch(`/api/admin/users/${userId}/activity?limit=${limit}&offset=${offset}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch user activity');
        return await response.json();
    } catch (error) {
        console.error('Error fetching user activity:', error);
        return null;
    }
}

export async function adminSearch(query) {
    try {
        const response = await fetch(`/api/admin/search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to perform search');
        return await response.json();
    } catch (error) {
        console.error('Error performing admin search:', error);
        return null;
    }
}

export async function createArticle(formData) {
    try {
        const response = await apiFetch('/api/admin/articles', {
            method: 'POST',
            credentials: 'include',
            body: formData 
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to create article');
        }
        invalidateCache(); 
        return data;
    } catch (error) {
        console.error('Error creating article:', error);
        return { success: false, error: error.message };
    }
}

export async function updateArticle(articleId, formData) {
    try {
        const response = await apiFetch(`/api/admin/articles/${articleId}`, {
            method: 'PUT',
            credentials: 'include',
            body: formData 
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to update article');
        }
        invalidateCache();
        return data;
    } catch (error) {
        console.error('Error updating article:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteArticle(articleId) {
    try {
        const response = await apiFetch(`/api/admin/articles/${articleId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to delete article');
        invalidateCache();
        return await response.json();
    } catch (error) {
        console.error('Error deleting article:', error);
        return { error: error.message };
    }
}

export async function toggleArticleStatus(articleId, currentStatus) {
    const newStatus = currentStatus === 'Published' ? 'Unpublished' : 'Published';
    try {
        const response = await apiFetch(`/api/admin/articles/${articleId}/status`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!response.ok) throw new Error('Failed to toggle status');
        invalidateCache();
        return await response.json();
    } catch (error) {
        console.error('Error toggling status:', error);
        return { error: error.message };
    }
}

export async function toggleArticleFeatured(articleId, currentFeatured) {
    const featured = !currentFeatured;
    try {
        const response = await apiFetch(`/api/admin/articles/${articleId}/featured`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ featured })
        });
        if (!response.ok) throw new Error('Failed to toggle featured status');
        invalidateCache();
        return await response.json();
    } catch (error) {
        console.error('Error toggling featured status:', error);
        return { error: error.message };
    }
}

export async function getAdminIssues() {
    try {
        const response = await fetch('/api/admin/issues', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch issues');
        return await response.json();
    } catch (error) {
        console.error('Error fetching issues:', error);
        return [];
    }
}

export async function addAdminIssue(formData) {
    try {
        const response = await apiFetch('/api/admin/issues', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to add issue');
        return data;
    } catch (error) {
        console.error('Error adding issue:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteAdminIssue(filename) {
    try {
        const response = await apiFetch(`/api/admin/issues/${filename}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to delete issue');
        return await response.json();
    } catch (error) {
        console.error('Error deleting issue:', error);
        return { error: error.message };
    }
}

export async function getAdminContacts() {
    try {
        const response = await fetch('/api/admin/contacts', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch contacts');
        return await response.json();
    } catch (error) {
        console.error('Error fetching admin contacts:', error);
        return null;
    }
}

export async function deleteAdminContact(id) {
    try {
        const response = await apiFetch(`/api/admin/contacts/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to delete contact');
        return await response.json();
    } catch (error) {
        console.error('Error deleting contact:', error);
        return { error: error.message };
    }
}

export async function getAdminStaff() {
    try {
        const response = await fetch('/api/admin/staff', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch staff');
        return await response.json();
    } catch (error) {
        console.error('Error fetching staff:', error);
        return [];
    }
}

export async function createAdminStaff(formData) {
    try {
        const response = await apiFetch('/api/admin/staff', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to add staff member');
        invalidateCache();
        return data;
    } catch (error) {
        console.error('Error creating staff member:', error);
        return { success: false, error: error.message };
    }
}

export async function updateAdminStaff(id, formData) {
    try {
        const response = await apiFetch(`/api/admin/staff/${id}`, {
            method: 'PUT',
            credentials: 'include',
            body: formData
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update staff member');
        invalidateCache();
        return data;
    } catch (error) {
        console.error('Error updating staff member:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteAdminStaff(id) {
    try {
        const response = await apiFetch(`/api/admin/staff/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to delete staff member');
        invalidateCache();
        return await response.json();
    } catch (error) {
        console.error('Error deleting staff member:', error);
        return { error: error.message };
    }
}

export async function getServerDraft(key) {
    try {
        const response = await apiFetch(`/api/admin/drafts/${encodeURIComponent(key)}`, {
            credentials: 'include'
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('Failed to fetch draft');
        return await response.json();
    } catch (error) {
        console.error('Error fetching server draft:', error);
        return null;
    }
}

export async function saveServerDraft(key, data) {
    try {
        const response = await apiFetch(`/api/admin/drafts/${encodeURIComponent(key)}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to save draft');
        return true;
    } catch (error) {
        console.error('Error saving server draft:', error);
        return false;
    }
}

export async function deleteServerDraft(key) {
    try {
        const response = await apiFetch(`/api/admin/drafts/${encodeURIComponent(key)}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to delete draft');
        return true;
    } catch (error) {
        console.error('Error deleting server draft:', error);
        return false;
    }
}