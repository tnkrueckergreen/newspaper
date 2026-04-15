import { getIsLoggedIn, handleLogout, updateCurrentUser, getCurrentUser, waitForAuth } from '../lib/auth.js';
import { navigate } from '../lib/router.js';
import { apiFetch } from '../lib/csrf.js';
import { getAccountData, deleteAccount, getCombinedData, changeUsername, changePassword, changeEmail, getAdminStats, getAdminUsers, deleteUserByAdmin, getAdminArticles, getRecentCommentsAdmin, editComment, deleteComment, getAdminDashboard, getUserProfile, getUserActivity, adminSearch, deleteArticle, toggleArticleStatus, toggleArticleFeatured, getAdminIssues, addAdminIssue, deleteAdminIssue, getAdminContacts, deleteAdminContact, getAdminStaff, createAdminStaff, updateAdminStaff, reorderAdminStaff, deleteAdminStaff } from '../lib/api.js';
import { showError, showSuccess, showWarning } from '../lib/toast.js';
import { Avatar } from '../components/common/Avatar.js';
import { initPasswordToggle } from '../lib/passwordToggle.js';
import { toRootRelativePath } from '../lib/paths.js';

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

let activeListeners = [];
// State for dashboard chart
let dashboardChartData = null;
let currentChartIndex = 0;
let dashboardLoadId = 0;
let pendingAdminSection = null;
let adminNavigationAttached = false;

// UPDATED: Removed article metrics, renamed authors title
const chartConfig = [
    { key: 'commenters', title: 'Top Commenters' },
    { key: 'authors', title: 'Top Authors' }
];

function addTrackedListener(element, type, handler, options) {
    if (element) {
        element.addEventListener(type, handler, options);
        activeListeners.push({ element, type, handler, options });
    }
}

function cleanupEventListeners() {
    activeListeners.forEach(({ element, type, handler, options }) => {
        element.removeEventListener(type, handler, options);
    });
    activeListeners = [];
    adminNavigationAttached = false;
}

function updateSettingsAvatarDisplay(user, previewUrl = null) {
    const avatarDisplayContainer = document.getElementById('avatar-display-container');
    if (!avatarDisplayContainer) return;

    const avatarHTML = Avatar({
        userId: user.user_id,
        username: user.username,
        customAvatar: previewUrl || user.custom_avatar,
        size: 'large',
        className: 'avatar-settings-preview'
    });
    avatarDisplayContainer.innerHTML = DOMPurify.sanitize(avatarHTML);
}

function pluralize(count, singular, plural) {
    return count === 1 ? singular : plural;
}

function AccountArticleCard(article) {
    if (!article) return '';
    const authorText = article.writers && article.writers.length > 0 ? `By ${article.writers.map(w => w.name).join(', ')}` : '';
    const imageSrc = toRootRelativePath(article.image, '/assets/icons/placeholder-image.svg');
    return `
        <div class="account-article-card">
            <a href="/article/${article.id}">
                <img src="${imageSrc}" alt="Article thumbnail for ${article.title}">
            </a>
            <div class="account-article-info">
                <div class="category">${article.category}</div>
                <h3><a href="/article/${article.id}">${article.title}</a></h3>
                <div class="author">${authorText}</div>
            </div>
        </div>
    `;
}

function CommentActivityCard(comment, article, currentUser) {
    if (!article) return '';

    const formattedDate = new Date(comment.timestamp).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    return `
        <li class="comment-activity-item">
            <div class="comment-context-article">
                ${AccountArticleCard(article)}
            </div>
            <div class="user-comment-bubble">
                ${Avatar({ userId: currentUser.user_id, username: currentUser.username, customAvatar: currentUser.custom_avatar, size: 'medium' })}
                <div>
                    <p class="user-comment-content">“${comment.content}”</p>
                    <p class="user-comment-meta">You commented on ${formattedDate}</p>
                </div>
            </div>
        </li>
    `;
}

function StatItem({ icon, value, label }) {
    return `
        <div class="stat-item" data-stat-type="${icon}">
            <div class="stat-icon-wrapper">
                <div class="stat-icon" data-icon="${icon}"></div>
            </div>
            <div class="stat-text">
                <div class="stat-value">${value}</div>
                <div class="stat-label">${label}</div>
            </div>
        </div>
    `;
}

function KPIItem({ icon, value, label, trend }) {
    return `
        <div class="kpi-card" data-stat-type="${icon}">
            <div class="kpi-icon-wrapper">
                <div class="kpi-icon" data-icon="${icon}"></div>
            </div>
            <div class="kpi-content">
                <div class="kpi-value">${value}</div>
                <div class="kpi-label">${label}</div>
                ${trend ? `<div class="kpi-trend positive">${trend}</div>` : ''}
            </div>
        </div>
    `;
}

// Icon asset references for actions
const actionIcons = {
    edit: `<img src="/assets/icons/edit-icon.svg" alt="" aria-hidden="true">`,
    trash: `<img src="/assets/icons/trash-icon.svg" alt="" aria-hidden="true">`,
    eye: `<img src="/assets/icons/eye-icon.svg" alt="" aria-hidden="true">`,
    eyeOff: `<img src="/assets/icons/eye-off-icon.svg" alt="" aria-hidden="true">`
};

// Helper for admin comment card
function AdminCommentCard(comment, article) {
    const avatarHTML = Avatar({
        userId: comment.author_id,
        username: comment.author_name,
        customAvatar: comment.custom_avatar,
        size: 'medium'
    });

    const formattedDate = new Date(comment.timestamp).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    return `
        <div class="comment-activity-item" id="admin-comment-${comment.comment_id}">
            <div class="comment-context-article">
                ${AccountArticleCard(article)}
            </div>

            <div id="admin-comment-view-${comment.comment_id}">
                <div class="user-comment-bubble" style="position: relative;">
                    <div style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.5rem;">
                        <button class="button-icon-only admin-edit-comment-btn" data-comment-id="${comment.comment_id}" title="Edit">
                            ${actionIcons.edit}
                        </button>
                        <button class="button-icon-only delete admin-delete-comment-btn" data-comment-id="${comment.comment_id}" title="Delete">
                            ${actionIcons.trash}
                        </button>
                    </div>

                    ${avatarHTML}
                    <div style="padding-right: 4rem;">
                        <p class="user-comment-content" id="admin-comment-content-${comment.comment_id}">“${comment.content}”</p>
                        <p class="user-comment-meta">${comment.author_name} commented on ${formattedDate}</p>
                    </div>
                </div>
            </div>

            <div class="admin-comment-edit-form" id="admin-edit-form-${comment.comment_id}" style="display: none; margin-top: 1rem;">
                <textarea class="admin-comment-textarea">${comment.content}</textarea>
                <div class="admin-comment-edit-actions">
                    <button class="button-secondary admin-cancel-edit-btn" data-comment-id="${comment.comment_id}">Cancel</button>
                    <button class="button-primary admin-save-edit-btn" data-comment-id="${comment.comment_id}">Save</button>
                </div>
            </div>
        </div>
    `;
}

function createAdminPanelHTML() {
    return `
    <div class="admin-panel-wrapper">
        <div class="admin-panel-header">
            <h2>Admin Dashboard</h2>
            <a href="/admin/create" class="button-primary">+ Create Post</a>
        </div>

        <nav class="admin-tabs-nav">
            <button class="admin-tab-link active" data-admin-section="overview">Overview</button>
            <button class="admin-tab-link" data-admin-section="moderation">Moderation</button>
            <button class="admin-tab-link" data-admin-section="users">Users</button>
            <button class="admin-tab-link" data-admin-section="content">Content</button>
            <button class="admin-tab-link" data-admin-section="featured">Featured</button>
            <button class="admin-tab-link" data-admin-section="issues">Issues</button>
            <button class="admin-tab-link" data-admin-section="staff">Staff</button>
            <button class="admin-tab-link" data-admin-section="responses">Responses</button>
        </nav>

        <div class="admin-sections-container">
            <div id="admin-overview-section" class="admin-section active">
                <div id="admin-dashboard-container"></div>
            </div>

            <div id="admin-moderation-section" class="admin-section">
                <div class="admin-card">
                    <div class="admin-card-header">
                        <h3>Comment Moderation Queue</h3>
                        <div class="admin-subtabs">
                            <button class="admin-subtab-btn active" data-moderation-tab="recent">Recent</button>
                            <button class="admin-subtab-btn" data-moderation-tab="all">View All</button>
                        </div>
                        <div class="admin-search-bar" style="margin-left: 1rem;">
                            <input type="text" id="comment-search" placeholder="Search comments..." />
                        </div>
                    </div>
                    <div id="admin-comments-container"></div>
                </div>
            </div>

            <div id="admin-users-section" class="admin-section">
                <div class="admin-card">
                    <div class="admin-card-header">
                        <h3>User Directory</h3>
                        <div class="admin-search-bar">
                            <input type="text" id="user-search" placeholder="Filter by username..." />
                        </div>
                    </div>
                    <div id="admin-users-container"></div>
                </div>
            </div>

            <div id="admin-content-section" class="admin-section">
                <div class="admin-card">
                    <div class="admin-card-header">
                        <h3>Content Analytics</h3>
                        <div style="display: flex; gap: 1rem; align-items: center;">
                            <div class="admin-search-bar">
                                <input type="text" id="article-search" placeholder="Filter articles..." />
                            </div>
                            <div class="sort-container" style="margin: 0;">
                                <select name="articles-sort-by" id="articles-sort-by">
                                    <option value="date-desc">Newest</option>
                                    <option value="likes-desc">Most Likes</option>
                                    <option value="comments-desc">Most Comments</option>
                                    <option value="views-desc">Most Views</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div id="admin-articles-container"></div>
                </div>
            </div>

            <div id="admin-featured-section" class="admin-section">
                <div class="admin-card">
                    <div class="admin-card-header">
                        <h3>Manage Featured Articles</h3>
                    </div>
                    <div class="admin-card-body" style="padding: 1.5rem;">
                        <p class="admin-section-desc">Up to 2 articles can be featured at a time. They appear prominently on the homepage.</p>
                        <div id="admin-featured-container"><div class="loader-inline"></div></div>
                    </div>
                </div>
            </div>

            <div id="admin-issues-section" class="admin-section">
                <div class="admin-card">
                    <div class="admin-card-header">
                        <h3>Issue PDF Management</h3>
                    </div>
                    <div class="admin-card-body" style="padding: 1.5rem;">
                        <form id="admin-add-issue-form" class="admin-form" style="margin-bottom: 2rem; border-bottom: 1px solid var(--color-border); padding-bottom: 2rem;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 1rem; align-items: end;">
                                <div class="form-group" style="grid-column: span 3;">
                                    <label for="issue-name">Full Issue Name (Auto-generated, but editable)</label>
                                    <input type="text" id="issue-name" placeholder="Volume X, Issue Y – Month Day, Year" required>
                                </div>
                                <div class="form-group">
                                    <label for="issue-volume">Volume</label>
                                    <input type="number" id="issue-volume" min="1" value="1" required>
                                </div>
                                <div class="form-group">
                                    <label for="issue-number">Issue</label>
                                    <input type="number" id="issue-number" min="1" value="1" required>
                                </div>
                                <div class="form-group">
                                    <label for="issue-date">Date</label>
                                    <input type="date" id="issue-date" required>
                                </div>
                                <div class="form-group">
                                    <label for="issue-pdf">PDF File</label>
                                    <input type="file" id="issue-pdf" accept="application/pdf" required>
                                </div>
                                <button type="submit" class="button-primary">Add Issue</button>
                            </div>
                        </form>
                        <div id="admin-issues-container"></div>
                    </div>
                </div>
            </div>


            <div id="admin-staff-section" class="admin-section">
                <div class="admin-card">
                    <div class="admin-card-header">
                        <h3>Staff Management</h3>
                        <button class="button-primary" id="admin-add-staff-btn">+ Add Staff Member</button>
                    </div>
                    <div class="admin-card-body" style="padding: 1.5rem;">
                        <div id="admin-staff-container"><div class="loader-inline"></div></div>
                    </div>
                </div>
            </div>

            <div id="admin-responses-section" class="admin-section">
                <div class="admin-card">
                    <div class="admin-card-header">
                        <h3>Contact Form Responses</h3>
                        <div class="admin-search-bar">
                            <input type="text" id="response-search" placeholder="Search by name or email..." />
                        </div>
                    </div>
                    <div id="admin-responses-container"></div>
                </div>
            </div>
        </div>
    </div>
    <div id="user-profile-modal" class="user-profile-modal" style="display: none;">
        <div class="user-profile-drawer">
            <div class="user-profile-header">
                <h3>User Profile</h3>
                <button class="close-profile-btn" aria-label="Close profile">×</button>
            </div>
            <div id="user-profile-content" class="user-profile-content"></div>
        </div>
    </div>
    `;
}

function createHTML(data) {
    if (!data) {
        return `<section class="page account-page"><div class="container"></div></section>`;
    }

    const { user, likedArticles, bookmarkedArticles, viewedArticles, commentsWithArticleData } = data;
    const { user_id, username, email, created_at, stats, custom_avatar } = user;

    const formattedJoinDate = new Date(created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    const capitalizedUsername = username.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');

    const accountAvatarHTML = Avatar({ userId: user_id, username, customAvatar: custom_avatar, size: 'large', className: 'account-avatar', isAdmin: user.is_admin || false });

    const emptyComments = `<div class="empty-state"><p>You haven't shared your thoughts yet.</p><a href="/articles/all" class="button-secondary">Browse Articles</a></div>`;
    const emptyLikes = `<div class="empty-state"><p>Show your appreciation for an article by liking it!</p><a href="/articles/all" class="button-secondary">Find Articles</a></div>`;
    const emptyBookmarks = `<div class="empty-state"><p>Save articles to read later.</p><a href="/articles/all" class="button-secondary">Browse Articles</a></div>`;

    const commentsHTML = commentsWithArticleData.length > 0
        ? commentsWithArticleData.map(item => CommentActivityCard(item.comment, item.article, user)).join('')
        : `<li>${emptyComments}</li>`;

    const likedArticlesHTML = likedArticles.length > 0 ? likedArticles.map(a => `<li>${AccountArticleCard(a)}</li>`).join('') : `<li>${emptyLikes}</li>`;
    const bookmarkedArticlesHTML = bookmarkedArticles.length > 0 ? bookmarkedArticles.map(a => `<li>${AccountArticleCard(a)}</li>`).join('') : `<li>${emptyBookmarks}</li>`;
    const recentlyViewedHTML = viewedArticles.length > 0 ? `<ul class="activity-list">${viewedArticles.map(a => `<li>${AccountArticleCard(a)}</li>`).join('')}</ul>` : `<div class="empty-state"><p>Articles you read will appear here.</p></div>`;

    let daysValue, daysLabel;
    if (stats.daysAsMember === 0) {
        daysValue = 'Today';
        daysLabel = 'Joined';
    } else {
        daysValue = stats.daysAsMember;
        daysLabel = pluralize(stats.daysAsMember, 'Day', 'Days') + ' Joined';
    }

    const adminNavItem = user.is_admin ? `<li><button class="account-sidebar-nav-link" data-tab="admin">Admin Panel</button></li>` : '';

    const sidebarHTML = `
        <aside class="account-sidebar">
            <div class="account-profile">
                ${accountAvatarHTML}
                <h1 id="account-welcome-heading">${capitalizedUsername}</h1>
                <p>Member since ${formattedJoinDate}</p>
            </div>
            <ul class="account-sidebar-nav" id="account-nav">
                <li><button class="account-sidebar-nav-link active" data-tab="dashboard">Dashboard</button></li>
                <li><button class="account-sidebar-nav-link" data-tab="comments">My Comments</button></li>
                <li><button class="account-sidebar-nav-link" data-tab="bookmarks">Bookmarked</button></li>
                <li><button class="account-sidebar-nav-link" data-tab="likes">Liked</button></li>
                <li><button class="account-sidebar-nav-link" data-tab="settings">Settings</button></li>
                ${adminNavItem}
            </ul>
        </aside>
    `;

    const statsGridHTML = `
        <div class="stats-grid">
            ${StatItem({ icon: 'view', value: stats.articlesViewed, label: 'Articles Read' })}
            ${StatItem({ icon: 'like', value: stats.likes, label: 'Likes Given' })}
            ${StatItem({ icon: 'bookmark', value: stats.bookmarks, label: 'Bookmarks' })}
            ${StatItem({ icon: 'comment', value: stats.comments, label: 'Comments' })}
            ${StatItem({ icon: 'tag', value: stats.topCategory, label: 'Fav Category' })}
            ${StatItem({ icon: 'calendar', value: daysValue, label: daysLabel })}
        </div>
    `;

    const mainContentHTML = `
        <div class="account-main-content">
            <div id="dashboard-tab" class="tab-pane active">
                 <div class="account-card">
                    <h2>Overview</h2>
                    ${statsGridHTML}
                </div>
                <div class="account-card"><h2>Jump Back In</h2>${recentlyViewedHTML}</div>
            </div>
            <div id="comments-tab" class="tab-pane"><div class="account-card"><h2>My Comments</h2><ul class="activity-list">${commentsHTML}</ul></div></div>
            <div id="bookmarks-tab" class="tab-pane"><div class="account-card"><h2>Bookmarked Articles</h2><ul class="activity-list">${bookmarkedArticlesHTML}</ul></div></div>
            <div id="likes-tab" class="tab-pane"><div class="account-card"><h2>Liked Articles</h2><ul class="activity-list">${likedArticlesHTML}</ul></div></div>
            ${user.is_admin ? `<div id="admin-tab" class="tab-pane">${createAdminPanelHTML()}</div>` : ''}
            <div id="settings-tab" class="tab-pane">
                <div class="account-card">
                    <h2>Account Settings</h2>
                    <div class="settings-section" id="avatar-section">
                        <div class="settings-info"><h3>Profile Avatar</h3><p>Upload a custom profile picture.</p></div>
                        <div class="avatar-setting-container">
                            <div id="avatar-display-container">
                                ${Avatar({ userId: user_id, username, customAvatar: custom_avatar, size: 'large', className: 'avatar-settings-preview', isAdmin: user.is_admin || false })}
                            </div>
                            <div class="avatar-actions">
                                <div id="avatar-actions-default"><button class="button-secondary" id="change-avatar-btn">Upload New</button>${custom_avatar ? `<button class="button-secondary" id="remove-avatar-btn">Remove</button>` : ''}</div>
                                <div id="avatar-actions-editing" style="display: none;"><button class="button-secondary" id="cancel-avatar-btn">Cancel</button><button class="button-primary" id="save-avatar-btn">Save</button></div>
                            </div>
                        </div>
                        <form id="avatar-form" style="display: none;"><input type="file" id="avatar-file" name="avatar" accept="image/jpeg,image/png"></form>
                    </div>
                    <div class="settings-section" data-section="username">
                        <div class="settings-info"><h3>Username</h3><p>Current: <strong>${username}</strong></p></div>
                        <div class="settings-actions"><button class="button-secondary change-btn" data-form-type="username">Edit</button></div>
                        <form class="edit-form" id="username-form">
                            <div class="form-group"><label for="new-username">New Username</label><input type="text" id="new-username" name="new-username" value="${username}" required minlength="3"></div>
                            <div class="edit-form-actions"><button type="button" class="button-secondary cancel-btn" data-form-type="username">Cancel</button><button type="submit" class="button-primary">Save Changes</button></div>
                        </form>
                    </div>
                    <div class="settings-section" data-section="email">
                        <div class="settings-info"><h3>Email Address</h3><p>Current: <strong>${email || 'Not set'}</strong></p></div>
                        <div class="settings-actions"><button class="button-secondary change-btn" data-form-type="email">Edit</button></div>
                        <form class="edit-form" id="email-form">
                            <div class="form-group"><label for="new-email">New Email Address</label><input type="email" id="new-email" name="new-email" value="${email || ''}" required placeholder="you@example.com"></div>
                            <div class="edit-form-actions"><button type="button" class="button-secondary cancel-btn" data-form-type="email">Cancel</button><button type="submit" class="button-primary">Save Changes</button></div>
                        </form>
                    </div>
                    <div class="settings-section" data-section="password">
                        <div class="settings-info"><h3>Password</h3><p>Change your account password.</p></div>
                        <div class="settings-actions"><button class="button-secondary change-btn" data-form-type="password">Edit</button></div>
                        <form class="edit-form" id="password-form">
                            <input type="text" name="username" value="${username}" autocomplete="username" style="display:none;" aria-hidden="true">
                            <div class="form-group"><label for="current-password">Current Password</label><div class="password-input-wrapper"><input type="password" id="current-password" name="current-password" required autocomplete="current-password"><button type="button" class="password-toggle-btn" aria-label="Show password"><img src="/assets/icons/eye-slash.svg" alt="Toggle password visibility"></button></div></div>
                            <div class="form-group"><label for="new-password">New Password</label><div class="password-input-wrapper"><input type="password" id="new-password" name="new-password" required minlength="6" autocomplete="new-password"><button type="button" class="password-toggle-btn" aria-label="Show password"><img src="/assets/icons/eye-slash.svg" alt="Toggle password visibility"></button></div></div>
                            <div class="form-group"><label for="confirm-password">Confirm New Password</label><div class="password-input-wrapper"><input type="password" id="confirm-password" name="confirm-password" required minlength="6" autocomplete="new-password"><button type="button" class="password-toggle-btn" aria-label="Show password"><img src="/assets/icons/eye-slash.svg" alt="Toggle password visibility"></button></div></div>
                            <div class="edit-form-actions"><button type="button" class="button-secondary cancel-btn" data-form-type="password">Cancel</button><button type="submit" class="button-primary">Save Changes</button></div>
                        </form>
                    </div>
                    <div class="settings-section"><div class="settings-info"><h3>Log Out</h3><p>Sign out of your account.</p></div><div class="settings-actions"><button id="logout-btn" class="button-secondary settings-btn">Log Out</button></div></div>
                    ${!user.is_admin ? `<div class="settings-section danger-zone">
                        <div class="settings-info">
                            <h3>Delete Account</h3>
                            <p>Permanently delete your account and all associated data. This action cannot be undone.</p>
                        </div>
                        <div class="settings-actions"><button id="delete-account-btn" class="button-danger settings-btn danger-zone-btn" title="Delete Account"><span class="danger-zone-icon-mask" aria-hidden="true"></span><span>Delete Account</span></button></div>
                    </div>` : ''}
                </div>
            </div>
        </div>
    `;

    return `
        <section class="page account-page">
            <div class="container">
                <div class="account-layout">
                    ${sidebarHTML}
                    ${mainContentHTML}
                </div>
            </div>
        </section>
    `;
}

// ─── Image Cropper Integration ────────────────────────────────────────────────
function openCropper(file, aspectRatio, onApply, onCancel) {
    if (typeof Cropper === 'undefined') {
        console.warn('Cropper.js not loaded, skipping crop.');
        onApply(file, file);
        return;
    }

    let cropperModal = document.getElementById('global-cropper-modal');
    if (!cropperModal) {
        cropperModal = document.createElement('div');
        cropperModal.id = 'global-cropper-modal';
        cropperModal.className = 'user-profile-modal';
        cropperModal.style.zIndex = '10005';
        cropperModal.innerHTML = `
            <div class="user-profile-drawer" style="max-width: 540px; height: auto; display: flex; flex-direction: column;">
                <div class="user-profile-header">
                    <h3>Crop Image</h3>
                    <button type="button" class="close-profile-btn" id="global-cropper-close-btn" aria-label="Close">×</button>
                </div>
                <div style="padding: 1.5rem; flex: 1; display: flex; flex-direction: column; gap: 1.5rem;">
                    <div style="width: 100%; height: 400px; background: var(--color-border); display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 8px;">
                        <img id="global-cropper-img-target" src="" style="max-width: 100%; max-height: 100%;">
                    </div>
                    <div style="display:flex; gap: 0.75rem; justify-content: flex-end;">
                        <button type="button" class="button-secondary" id="global-cropper-cancel-btn">Cancel</button>
                        <button type="button" class="button-primary" id="global-cropper-apply-btn">Apply Crop</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(cropperModal);
    }

    const imgTarget = document.getElementById('global-cropper-img-target');
    const url = URL.createObjectURL(file);
    imgTarget.src = url;
    cropperModal.style.display = 'flex';

    let cropperInstance = null;
    setTimeout(() => {
        cropperInstance = new Cropper(imgTarget, {
            aspectRatio: aspectRatio,
            viewMode: 1,
            autoCropArea: 1,
            background: false,
            zoomable: false,
        });
    }, 50);

    const applyBtn = document.getElementById('global-cropper-apply-btn');
    const cancelBtn = document.getElementById('global-cropper-cancel-btn');
    const closeBtn = document.getElementById('global-cropper-close-btn');

    const closeAndCleanup = () => {
        cropperModal.style.display = 'none';
        if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
        }
        URL.revokeObjectURL(url);

        // Remove listeners by cloning the buttons to avoid duplicate event calls on next load
        applyBtn.replaceWith(applyBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        closeBtn.replaceWith(closeBtn.cloneNode(true));
    };

    applyBtn.addEventListener('click', () => {
        if (!cropperInstance) return;
        const btnOriginalText = applyBtn.textContent;
        applyBtn.textContent = 'Cropping...';
        applyBtn.disabled = true;

        cropperInstance.getCroppedCanvas({ width: 800, height: 800 }).toBlob((blob) => {
            applyBtn.textContent = btnOriginalText;
            applyBtn.disabled = false;
            const croppedFile = new File([blob], file.name, { type: file.type || 'image/jpeg' });
            onApply(croppedFile, blob);
            closeAndCleanup();
        }, file.type || 'image/jpeg', 0.9);
    }, { once: true });

    const handleCancel = () => {
        if (onCancel) onCancel();
        closeAndCleanup();
    };

    cancelBtn.addEventListener('click', handleCancel, { once: true });
    closeBtn.addEventListener('click', handleCancel, { once: true });
}

function attachFormListeners() {
    const usernameForm = document.getElementById('username-form');
    if (usernameForm) {
        const handleUsernameSubmit = async (e) => {
            e.preventDefault();
            const newUsername = document.getElementById('new-username').value;
            const result = await changeUsername(newUsername);
            if (result.success) {
                showSuccess('Username updated successfully!');
                updateCurrentUser(result.user);
                const capitalized = result.user.username.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                document.getElementById('account-welcome-heading').textContent = capitalized;
                document.querySelector('[data-section="username"] p strong').textContent = result.user.username;
                document.querySelector('[data-section="username"]').classList.remove('is-editing');
            } else {
                showError(result.error);
            }
        };
        addTrackedListener(usernameForm, 'submit', handleUsernameSubmit);
    }

    const emailForm = document.getElementById('email-form');
    if (emailForm) {
        const handleEmailSubmit = async (e) => {
            e.preventDefault();
            const newEmail = document.getElementById('new-email').value.trim();
            const result = await changeEmail(newEmail);
            if (result.success) {
                showSuccess('Email updated successfully!');
                updateCurrentUser(result.user);
                document.querySelector('[data-section="email"] p strong').textContent = result.user.email;
                document.querySelector('[data-section="email"]').classList.remove('is-editing');
            } else {
                showError(result.error);
            }
        };
        addTrackedListener(emailForm, 'submit', handleEmailSubmit);
    }

    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        const handlePasswordSubmit = async (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            if (newPassword !== confirmPassword) {
                showError('New passwords do not match.');
                return;
            }
            const result = await changePassword(currentPassword, newPassword);
            if (result.success) {
                showSuccess('Password updated successfully!');
                passwordForm.reset();
                document.querySelector('[data-section="password"]').classList.remove('is-editing');
            } else {
                showError(result.error);
            }
        };
        addTrackedListener(passwordForm, 'submit', handlePasswordSubmit);
        initPasswordToggle(passwordForm);
    }

    const avatarSection = document.getElementById('avatar-section');
    if (!avatarSection) return;

    const fileInput = document.getElementById('avatar-file');
    const changeBtn = document.getElementById('change-avatar-btn');
    const cancelBtn = document.getElementById('cancel-avatar-btn');
    const saveBtn = document.getElementById('save-avatar-btn');
    const defaultActions = document.getElementById('avatar-actions-default');
    const editingActions = document.getElementById('avatar-actions-editing');

    addTrackedListener(changeBtn, 'click', () => fileInput.click());

    addTrackedListener(fileInput, 'change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            showError('File size must be less than 5MB');
            fileInput.value = '';
            return;
        }

        openCropper(file, 1, (croppedFile, blob) => {
            const dt = new DataTransfer();
            dt.items.add(croppedFile);
            fileInput.files = dt.files;

            const reader = new FileReader();
            reader.onload = (event) => {
                updateSettingsAvatarDisplay(getCurrentUser(), event.target.result);
                defaultActions.style.display = 'none';
                editingActions.style.display = 'flex';
            };
            reader.readAsDataURL(blob);
        }, () => {
            fileInput.value = '';
        });
    });

    addTrackedListener(cancelBtn, 'click', () => {
        updateSettingsAvatarDisplay(getCurrentUser());
        fileInput.value = '';
        defaultActions.style.display = 'flex';
        editingActions.style.display = 'none';
    });

    addTrackedListener(saveBtn, 'click', async () => {
        const formData = new FormData();
        const file = fileInput.files[0];
        if (!file) {
            showError('Please select an image file first.');
            return;
        }
        formData.append('avatar', file);

        try {
            const response = await apiFetch('/api/account/avatar', { method: 'POST', body: formData });
            const result = await response.json();
            if (response.ok) {
                showSuccess('Avatar updated successfully!');
                const newUser = { ...getCurrentUser(), custom_avatar: result.avatarUrl };
                updateCurrentUser(newUser);
                cancelBtn.click();
                if (!document.getElementById('remove-avatar-btn')) {
                    const removeBtnHTML = `<button class="button-secondary" id="remove-avatar-btn">Remove</button>`;
                    defaultActions.insertAdjacentHTML('beforeend', removeBtnHTML);
                }
            } else {
                showError(result.error || 'Failed to upload avatar.');
                cancelBtn.click();
            }
        } catch (error) {
            showError('Failed to upload avatar. Please try again.');
            cancelBtn.click();
        }
    });
}

function attachRemoveAvatarListener() {
    const avatarSection = document.getElementById('avatar-section');
    if (avatarSection) {
        const handleAvatarClick = async (e) => {
            if (e.target.id !== 'remove-avatar-btn') return;
            if (!confirm('Are you sure you want to remove your custom avatar?')) return;
            try {
                const response = await apiFetch('/api/account/avatar', { method: 'DELETE' });
                const result = await response.json();
                if (response.ok) {
                    showSuccess('Custom avatar removed!');
                    const newUser = { ...getCurrentUser(), custom_avatar: null };
                    updateCurrentUser(newUser);
                    e.target.remove();
                } else {
                    showError(result.error || 'Failed to remove avatar');
                }
            } catch (error) {
                showError('Failed to remove avatar. Please try again.');
            }
        };
        addTrackedListener(avatarSection, 'click', handleAvatarClick);
    }
}

function attachEventListeners() {
    const nav = document.getElementById('account-nav');
    addTrackedListener(nav, 'click', (e) => {
        const tabBtn = e.target.closest('.account-sidebar-nav-link');
        if (!tabBtn) return;

        nav.querySelectorAll('.account-sidebar-nav-link').forEach(btn => btn.classList.remove('active'));
        tabBtn.classList.add('active');

        const targetTabId = `${tabBtn.dataset.tab}-tab`;
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === targetTabId);
        });

        if (tabBtn.dataset.tab === 'admin') {
            loadAdminData();
        }
    });

    const settingsTab = document.getElementById('settings-tab');
    addTrackedListener(settingsTab, 'click', (e) => {
        const changeBtn = e.target.closest('.change-btn');
        if (changeBtn) {
            changeBtn.closest('.settings-section').classList.add('is-editing');
        }
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            cancelBtn.closest('.settings-section').classList.remove('is-editing');
        }
    });

    const logoutBtn = document.getElementById('logout-btn');
    addTrackedListener(logoutBtn, 'click', handleLogout);

    const deleteBtn = document.getElementById('delete-account-btn');
    addTrackedListener(deleteBtn, 'click', async () => {
        const confirmation = prompt('This action is irreversible. To confirm, please type "DELETE" in the box below.');
        if (confirmation === 'DELETE') {
            const result = await deleteAccount();
            if (result) {
                showSuccess('Your account has been permanently deleted.');
                setTimeout(() => location.reload(), 1500);
            } else {
                showError('Could not delete account. Please try again.');
            }
        } else if (confirmation !== null) {
            showError('Deletion cancelled. Confirmation text did not match.');
        }
    });

    attachFormListeners();
    attachRemoveAvatarListener();
    attachAdminEventListeners();
}

async function loadAdminData() {
    await loadAdminDashboard();
    attachAdminNavigation();
}

async function loadAdminDashboard() {
    const container = document.getElementById('admin-dashboard-container');
    if (!container) return;

    // Reset chart state and capture a load ID so that if the user navigates
    // away and back quickly, a slow in-flight fetch from the first load cannot
    // overwrite the state that the second load has already set.
    dashboardChartData = null;
    currentChartIndex = 0;
    const thisLoadId = ++dashboardLoadId;

    const dashboardData = await getAdminDashboard();

    // A newer loadAdminDashboard call has superseded this one — bail out.
    if (thisLoadId !== dashboardLoadId) return;

    if (!dashboardData) {
        container.innerHTML = '<p class="error-message">Failed to load dashboard data</p>';
        return;
    }
    dashboardChartData = dashboardData;

    const { overview } = dashboardChartData;

    container.innerHTML = `
        <div class="dashboard-kpi-grid">
            ${KPIItem({ icon: 'users', value: overview.totalUsers, label: 'Users', trend: `+${overview.newUsersThisWeek} new` })}
            ${KPIItem({ icon: 'article', value: overview.totalArticles, label: 'Articles' })}
            ${KPIItem({ icon: 'comment', value: overview.totalComments, label: 'Comments', trend: `+${overview.newCommentsThisWeek} new` })}
            ${KPIItem({ icon: 'view', value: overview.totalViews, label: 'Views', trend: `+${overview.newViewsThisWeek} new` })}
            ${KPIItem({ icon: 'like', value: overview.totalLikes, label: 'Likes' })}
        </div>
        <div class="dashboard-cache-actions">
            <button id="refresh-cache-btn" class="admin-action-btn">Refresh Content Cache</button>
            <span id="refresh-cache-status" class="refresh-cache-status"></span>
        </div>
        <div class="dashboard-contributors" id="contributors-chart-container">
            <!-- Chart content injected here -->
        </div>
    `;

    const refreshBtn = document.getElementById('refresh-cache-btn');
    const refreshStatus = document.getElementById('refresh-cache-status');
    addTrackedListener(refreshBtn, 'click', async () => {
        refreshBtn.disabled = true;
        refreshStatus.textContent = 'Refreshing...';
        refreshStatus.className = 'refresh-cache-status';
        try {
            const res = await apiFetch('/api/admin/cache/refresh', { method: 'POST' });
            if (res.ok) {
                refreshStatus.textContent = 'Cache refreshed successfully.';
                refreshStatus.classList.add('success');
            } else {
                refreshStatus.textContent = 'Refresh failed. Try again.';
                refreshStatus.classList.add('error');
            }
        } catch {
            refreshStatus.textContent = 'Network error. Try again.';
            refreshStatus.classList.add('error');
        }
        refreshBtn.disabled = false;
        setTimeout(() => { refreshStatus.textContent = ''; refreshStatus.className = 'refresh-cache-status'; }, 4000);
    });

    const chartContainer = document.getElementById('contributors-chart-container');
    addTrackedListener(chartContainer, 'click', () => {
        currentChartIndex = (currentChartIndex + 1) % chartConfig.length;
        renderContributorsChart();
    });

    renderContributorsChart();
}

// UPDATED: Render function with Avatars, Dots, and nicer layout
function renderContributorsChart() {
    const container = document.getElementById('contributors-chart-container');
    if (!container || !dashboardChartData) return;

    const currentConfig = chartConfig[currentChartIndex];
    const data = dashboardChartData.charts[currentConfig.key];

    // Calculate max value for scaling
    const maxVal = data.length > 0 ? Math.max(...data.map(d => d.value), 1) : 1;

    // Create Navigation Dots
    const dotsHTML = chartConfig.map((_, index) => 
        `<span class="chart-dot ${index === currentChartIndex ? 'active' : ''}"></span>`
    ).join('');

    const listHTML = data.map(item => {
        const percentage = Math.max((item.value / maxVal) * 100, 2);

        // Use Avatar component
        const avatarHTML = Avatar({
            userId: item.id || null, 
            username: item.label,
            customAvatar: item.avatar || null,
            size: 'small',
            className: 'chart-avatar-img'
        });

        return `
            <div class="chart-row">
                <div class="chart-info">
                    ${avatarHTML}
                    <span class="chart-label" title="${item.label}">${item.label}</span>
                </div>
                <div class="chart-visuals">
                    <div class="chart-bar-container">
                        <div class="chart-bar" style="width: ${percentage}%;"></div>
                    </div>
                    <span class="chart-value">${item.value}</span>
                </div>
            </div>
        `;
    }).join('');

    // Updated HTML structure: Header (Title only), Chart, Footer (Dots)
    const chartHTML = `
        <div class="chart-header">
            <h3>${currentConfig.title}</h3>
        </div>
        <div class="contributors-chart">
            ${data.length > 0 ? listHTML : '<p class="empty-state-text">No data available.</p>'}
        </div>
        <div class="chart-footer">
            <div class="chart-pagination">${dotsHTML}</div>
        </div>
    `;

    container.innerHTML = chartHTML;
}

async function loadAdminUsers() {
    const container = document.getElementById('admin-users-container');
    if (!container) return;
    const users = await getAdminUsers();
    if (!users || users.length === 0) {
        container.innerHTML = '<p>No users found.</p>';
        return;
    }
    const currentUser = getCurrentUser();
    container.innerHTML = `
    <div class="users-table-wrapper">
        <table class="admin-table modern-table" id="users-table">
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Joined</th>
                    <th>Comments</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(user => `
                <tr data-user-id="${user.user_id}" data-username="${user.username}">
                    <td>
                        <div class="user-cell">
                             <button class="view-user-link" data-user-id="${user.user_id}">
                                ${user.username}
                                ${user.is_admin ? '<span class="admin-badge">Admin</span>' : ''}
                            </button>
                        </div>
                    </td>
                    <td>${new Date(user.created_at).toLocaleDateString()}</td>
                    <td><span class="badge badge-info">${user.comment_count}</span></td>
                    <td><span class="status-badge status-active">Active</span></td>
                    <td>
                         ${user.user_id !== currentUser.user_id ? 
                            `<button class="button-danger admin-delete-user-btn" data-user-id="${user.user_id}">Delete</button>` 
                            : '<span class="disabled-text">You</span>'}
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>
    `;
}

async function loadAdminArticles() {
    const container = document.getElementById('admin-articles-container');
    if (!container) return;

    const articles = await getAdminArticles();
    if (!articles || articles.length === 0) {
        container.innerHTML = '<p class="empty-state-text">No articles found.</p>';
        return;
    }

    container.innerHTML = `
        <div class="users-table-wrapper">
            <table class="admin-table" id="articles-table">
                <thead>
                    <tr>
                        <th style="width: 45%;">Article</th>
                        <th style="width: 10%;">Status</th>
                        <th>Stats</th>
                        <th class="text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${articles.map(article => {
                        const isUnpublished = article.status === 'Unpublished';
                        const isScheduled = article.status === 'Scheduled';
                        const statusClass = isScheduled ? 'status-scheduled' : isUnpublished ? 'status-unpublished' : 'status-published';
                        const statusText = isScheduled ? 'Scheduled' : isUnpublished ? 'Draft' : 'Live';

                        const toggleIcon = isUnpublished ? actionIcons.eyeOff : actionIcons.eye;
                        const toggleTitle = isUnpublished ? 'Publish Article' : 'Unpublish Article';

                        return `
                        <tr data-article-id="${article.id}" data-status="${article.status}" data-date="${article.date}" data-title="${article.title}" data-likes="${article.likes}" data-comments="${article.comments}" data-views="${article.views}">
                            <td>
                                <div class="article-cell-main">
                                    <a href="/article/${article.id}" class="article-title-link" target="_blank">${article.title}</a>
                                </div>
                                <div class="article-meta-sub">
                                    ${article.category} • ${new Date(article.date).toLocaleDateString()}
                                </div>
                            </td>
                            <td>
                                <span class="status-badge ${statusClass}">${statusText}</span>
                            </td>
                            <td>
                                <div class="stats-row">
                                    <span title="Views">👁 ${article.views}</span>
                                    <span title="Likes">👍 ${article.likes}</span>
                                    <span title="Comments">💬 ${article.comments}</span>
                                </div>
                            </td>
                            <td class="text-right">
                                <div class="action-btn-group">
                                    <a href="/admin/edit/${article.id}" class="button-icon-only" title="Edit">
                                        ${actionIcons.edit}
                                    </a>
                                    <button class="button-icon-only admin-toggle-status-btn" title="${toggleTitle}">
                                        ${toggleIcon}
                                    </button>
                                    <button class="button-icon-only delete admin-delete-article-btn" title="Delete">
                                        ${actionIcons.trash}
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function loadAdminFeatured() {
    const container = document.getElementById('admin-featured-container');
    if (!container) return;

    container.innerHTML = '<div class="loader-inline"></div>';

    const articles = await getAdminArticles();
    if (!articles || articles.length === 0) {
        container.innerHTML = '<p class="empty-state-text">No articles found.</p>';
        return;
    }

    const featuredArticles = articles.filter(a => a.featured);
    const publishedArticles = articles.filter(a => !a.featured && a.status === 'Published');
    const otherArticles = articles.filter(a => !a.featured && a.status !== 'Published');

    const starIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    const starOutlineIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

    const slotsUsed = featuredArticles.length;
    const slotsAvailable = Math.max(0, 2 - slotsUsed);

    const featuredSlotsHTML = `
        <div class="featured-slots">
            ${featuredArticles.map(a => `
                <div class="featured-slot featured-slot--filled" data-article-id="${a.id}" data-featured="true">
                    <div class="featured-slot-star">${starIcon}</div>
                    <div class="featured-slot-content">
                        <span class="featured-slot-title">${a.title}</span>
                        <span class="featured-slot-meta">${a.category} &middot; ${new Date(a.date).toLocaleDateString()}</span>
                    </div>
                    <button class="button-secondary admin-toggle-featured-btn" data-article-id="${a.id}" data-featured="true" title="Remove from featured">
                        Remove
                    </button>
                </div>
            `).join('')}
            ${Array.from({ length: slotsAvailable }, (_, i) => `
                <div class="featured-slot featured-slot--empty">
                    <div class="featured-slot-star featured-slot-star--empty">${starOutlineIcon}</div>
                    <div class="featured-slot-content">
                        <span class="featured-slot-title featured-slot-title--empty">Empty slot</span>
                        <span class="featured-slot-meta">Select an article below to feature it</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    const renderArticleRows = (list) => list.map(a => `
        <tr data-article-id="${a.id}" data-featured="${a.featured}">
            <td>
                <div class="article-cell-main">
                    <a href="/article/${a.id}" class="article-title-link" target="_blank">${a.title}</a>
                </div>
                <div class="article-meta-sub">${a.category} &middot; ${new Date(a.date).toLocaleDateString()}</div>
            </td>
            <td>
                <span class="status-badge ${a.status === 'Published' ? 'status-published' : 'status-unpublished'}">${a.status === 'Published' ? 'Live' : 'Draft'}</span>
            </td>
            <td class="text-right">
                <button class="button-icon-only admin-toggle-featured-btn ${a.featured ? 'featured-active' : ''}" data-article-id="${a.id}" data-featured="${a.featured}" title="${a.featured ? 'Remove from featured' : 'Set as featured'}" ${!a.featured && slotsUsed >= 2 ? 'disabled title="Both featured slots are taken"' : ''}>
                    ${a.featured ? starIcon : starOutlineIcon}
                </button>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <h4 class="featured-slots-heading">Featured Slots (${slotsUsed}/2)</h4>
        ${featuredSlotsHTML}

        <div style="margin-top: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h4 style="margin: 0;">All Articles</h4>
                <div class="admin-search-bar">
                    <input type="text" id="featured-article-search" placeholder="Filter articles..." />
                </div>
            </div>
            <div class="users-table-wrapper">
                <table class="admin-table" id="featured-articles-table">
                    <thead>
                        <tr>
                            <th>Article</th>
                            <th>Status</th>
                            <th class="text-right">Feature</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderArticleRows([...featuredArticles, ...publishedArticles, ...otherArticles])}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const searchInput = document.getElementById('featured-article-search');
    if (searchInput) {
        addTrackedListener(searchInput, 'input', (e) => {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll('#featured-articles-table tbody tr').forEach(row => {
                const title = row.querySelector('.article-title-link')?.textContent.toLowerCase() || '';
                row.style.display = title.includes(term) ? '' : 'none';
            });
        });
    }
}

async function loadAdminComments(limit = 5, filterQuery = '') {
    const container = document.getElementById('admin-comments-container');
    if (!container) return;

    // If performing a search, disable the tabs to avoid confusion
    const moderationTabs = document.querySelectorAll('.admin-subtab-btn[data-moderation-tab]');
    if (filterQuery) {
        moderationTabs.forEach(tab => tab.classList.remove('active'));
    }

    // Dim content instead of clearing it
    container.classList.add('admin-loading-state');

    // If filtering, fetch ALL (-1) to search properly. Otherwise use passed limit.
    const fetchLimit = filterQuery ? -1 : limit;
    const comments = await getRecentCommentsAdmin(fetchLimit);

    // Always remove loading state even if empty
    container.classList.remove('admin-loading-state');

    if (!comments || comments.length === 0) {
        container.innerHTML = '<p class="empty-state-text">No comments found.</p>';
        return;
    }

    const siteData = await getCombinedData();
    if (!siteData) return; // null = cache invalidated mid-flight (e.g. logout)
    const { articles } = siteData;
    const articleMap = new Map(articles.map(a => [a.id, a]));

    // Filter client-side if query exists
    const filteredComments = filterQuery 
        ? comments.filter(c => 
            c.content.toLowerCase().includes(filterQuery.toLowerCase()) || 
            c.author_name.toLowerCase().includes(filterQuery.toLowerCase())
          )
        : comments;

    if (filteredComments.length === 0) {
        container.innerHTML = `<p class="empty-state-text">No comments match "${filterQuery}"</p>`;
        return;
    }

    // Use the AdminCommentCard helper
    container.innerHTML = `
        <ul class="activity-list admin-comments-list">
            ${filteredComments.map(comment => {
                const article = articleMap.get(comment.article_id);
                return AdminCommentCard(comment, article);
            }).join('')}
        </ul>
    `;
}

async function showUserProfile(userId) {
    const modal = document.getElementById('user-profile-modal');
    const content = document.getElementById('user-profile-content');

    if (!modal || !content) return;

    modal.style.display = 'flex';
    content.innerHTML = '';

    const [profile, activity] = await Promise.all([
        getUserProfile(userId),
        getUserActivity(userId, 50, 0)
    ]);

    if (!profile || !activity) {
        content.innerHTML = '<p class="error-message">Failed to load user profile</p>';
        return;
    }

    const siteData = await getCombinedData();
    if (!siteData) return; // null = cache invalidated mid-flight (e.g. logout)
    const { articles } = siteData;
    const articleMap = new Map(articles.map(a => [a.id, a]));

    content.innerHTML = `
        <div class="profile-info-section">
            <div class="profile-avatar">
                ${Avatar({ userId: profile.user_id, username: profile.username, customAvatar: profile.custom_avatar, size: 'large' })}
            </div>
            <div class="profile-details">
                <h4>${profile.username} ${profile.is_admin ? '<span class="admin-badge">Admin</span>' : ''}</h4>
                <p class="profile-meta">Joined ${new Date(profile.created_at).toLocaleDateString()}</p>
            </div>
        </div>

        <div class="profile-stats-grid">
            <div class="profile-stat">
                <div class="profile-stat-value">${profile.stats.comments}</div>
                <div class="profile-stat-label">Comments</div>
            </div>
            <div class="profile-stat">
                <div class="profile-stat-value">${profile.stats.likes}</div>
                <div class="profile-stat-label">Likes</div>
            </div>
            <div class="profile-stat">
                <div class="profile-stat-value">${profile.stats.bookmarks}</div>
                <div class="profile-stat-label">Bookmarks</div>
            </div>
            <div class="profile-stat">
                <div class="profile-stat-value">${profile.stats.views}</div>
                <div class="profile-stat-label">Views</div>
            </div>
        </div>

        <div class="profile-activity-section">
            <h4>Recent Activity</h4>
            <div class="profile-comments-list">
                ${activity.comments.length > 0 ? activity.comments.map(comment => {
                    const article = articleMap.get(comment.article_id);
                    return `
                        <div class="profile-comment-item">
                            <div class="profile-comment-article">
                                <a href="/article/${comment.article_id}">
                                    ${article ? article.title : 'Unknown Article'}
                                </a>
                            </div>
                            <div class="profile-comment-content">"${comment.content}"</div>
                            <div class="profile-comment-date">${new Date(comment.timestamp).toLocaleDateString()}</div>
                        </div>
                    `;
                }).join('') : '<p class="empty-state-text">No comments found</p>'}
            </div>
        </div>
    `;
}

function closeUserProfile() {
    const modal = document.getElementById('user-profile-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function loadAdminIssues() {
    const container = document.getElementById('admin-issues-container');
    if (!container) return;

    container.innerHTML = '<div class="loader-inline"></div>';
    const issues = await getAdminIssues();

    function attachIssueDeleteListener(btn) {
        addTrackedListener(btn, 'click', async () => {
            const filename = btn.getAttribute('data-filename');
            if (confirm(`Are you sure you want to delete the issue "${filename}"?`)) {
                const row = btn.closest('tr');
                btn.disabled = true;
                const result = await deleteAdminIssue(filename);
                if (result.success) {
                    showSuccess('Issue deleted successfully');
                    row?.remove();
                    if (!container.querySelector('tbody tr')) {
                        container.innerHTML = '<p class="empty-state-text">No issues found.</p>';
                    }
                } else {
                    btn.disabled = false;
                    showError(result.error);
                }
            }
        });
    }

    function createIssueRow(issue) {
        const row = document.createElement('tr');
        row.dataset.issueFilename = issue.filename;
        row.innerHTML = `
            <td>${issue.name}</td>
            <td>${new Date(issue.date).toLocaleDateString()}</td>
            <td>${issue.filename}</td>
            <td class="text-right">
                <div class="action-btn-group">
                    <a href="${issue.url || `/data/issues/pdfs/${issue.filename}`}" target="_blank" class="button-icon-only" title="View PDF">
                        ${actionIcons.eye}
                    </a>
                    <button class="button-icon-only delete admin-delete-issue-btn" data-filename="${issue.filename}" title="Delete Issue">
                        ${actionIcons.trash}
                    </button>
                </div>
            </td>
        `;
        attachIssueDeleteListener(row.querySelector('.admin-delete-issue-btn'));
        return row;
    }

    function addIssueRow(issue) {
        let tbody = container.querySelector('tbody');
        if (!tbody) {
            container.innerHTML = `
                <div class="users-table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Issue Name</th>
                                <th>Date</th>
                                <th>Filename</th>
                                <th class="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            `;
            tbody = container.querySelector('tbody');
        }

        const newRow = createIssueRow(issue);
        const newDate = new Date(issue.date);
        const rows = [...tbody.querySelectorAll('tr')];
        const nextRow = rows.find(row => {
            const existingDate = new Date(row.children[1].textContent);
            return newDate > existingDate;
        });
        tbody.insertBefore(newRow, nextRow || null);
    }

    // Pre-calculate next logical issue
    if (issues && issues.length > 0) {
        // Expecting names like "Volume X, Issue Y – Month Day, Year"
        // Try to find the first one that matches the pattern
        const latestIssue = issues.find(i => i.name.match(/Volume\s+(\d+),\s+Issue\s+(\d+)/i));
        if (latestIssue) {
            const match = latestIssue.name.match(/Volume\s+(\d+),\s+Issue\s+(\d+)/i);
            let vol = parseInt(match[1]);
            let iss = parseInt(match[2]);

            if (iss >= 6) {
                iss = 1;
                vol += 1;
            } else {
                iss += 1;
            }

            const volInput = document.getElementById('issue-volume');
            const issInput = document.getElementById('issue-number');
            const nameInput = document.getElementById('issue-name');
            const dateInput = document.getElementById('issue-date');

            if (volInput) volInput.value = vol;
            if (issInput) issInput.value = iss;

            // Trigger name generation if date is set
            if (dateInput && dateInput.value) {
                const dateObj = new Date(dateInput.value);
                const options = { month: 'long', day: 'numeric', year: 'numeric' };
                const formattedDate = dateObj.toLocaleDateString('en-US', options);
                if (nameInput) nameInput.value = `Volume ${vol}, Issue ${iss} – ${formattedDate}`;
            }
        }
    }

    if (issues.length === 0) {
        container.innerHTML = '<p class="empty-state-text">No issues found.</p>';
    } else {
        container.innerHTML = `
            <div class="users-table-wrapper">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Issue Name</th>
                            <th>Date</th>
                            <th>Filename</th>
                            <th class="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${issues.map(issue => createIssueRow(issue).outerHTML).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.querySelectorAll('.admin-delete-issue-btn').forEach(btn => {
            attachIssueDeleteListener(btn);
        });
    }

    const addIssueForm = document.getElementById('admin-add-issue-form');
    if (addIssueForm && !addIssueForm.dataset.listenerAttached) {
        addIssueForm.dataset.listenerAttached = 'true';

        const nameInput = document.getElementById('issue-name');
        const volInput = document.getElementById('issue-volume');
        const issInput = document.getElementById('issue-number');
        const dateInput = document.getElementById('issue-date');
        setupSmartQuotes(nameInput);

        const updateGeneratedName = () => {
            if (!dateInput.value) return;
            const [year, month, day] = dateInput.value.split('-').map(Number);
            const dateObj = new Date(year, month - 1, day);
            const options = { month: 'long', day: 'numeric', year: 'numeric' };
            const formattedDate = dateObj.toLocaleDateString('en-US', options);
            nameInput.value = `Volume ${volInput.value}, Issue ${issInput.value} – ${formattedDate}`;
        };

        [volInput, issInput, dateInput].forEach(input => {
            addTrackedListener(input, 'change', updateGeneratedName);
            if (input === volInput || input === issInput) {
                addTrackedListener(input, 'input', updateGeneratedName);
            }
        });

        addTrackedListener(addIssueForm, 'submit', async (e) => {
            e.preventDefault();

            const issueName = document.getElementById('issue-name').value;
            const dateVal = document.getElementById('issue-date').value;

            const formData = new FormData();
            formData.append('name', issueName);
            formData.append('date', dateVal);
            formData.append('pdf', document.getElementById('issue-pdf').files[0]);

            const submitBtn = addIssueForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Adding...';

            const result = await addAdminIssue(formData);

            submitBtn.disabled = false;
            submitBtn.textContent = originalText;

            if (result.success) {
                showSuccess('Issue added successfully');
                addIssueForm.reset();
                addIssueRow(result.issue);
            } else {
                showError(result.error);
            }
        });
    }
}

// ─── Staff Management ──────────────────────────────────────────────────────────

const STAFF_ROLES = [
    "Associate Editor", "Arts Editor", "Co-Editor-in-Chief", "Contributor",
    "Copy Editor", "Correspondent", "Editorial Board", "Editor-in-Chief",
    "Executive Editor", "Faculty Advisor", "Guest Columnist", "Layout Editor",
    "Managing Editor", "Online Editor", "Opinion Editor", "Photographer",
    "Social Media Manager", "Sports Editor", "Staff Writer"
];

function staffModalSetPreview(src) {
    const p = document.getElementById('staff-modal-preview');
    const rb = document.getElementById('staff-remove-btn');
    if (!p || !rb) return;
    if (src) {
        p.style.backgroundImage = `url('${src}')`;
        rb.style.display = '';
    } else {
        p.style.backgroundImage = '';
        rb.style.display = 'none';
    }
}

function openStaffModal(member = null) {
    let modal = document.getElementById('admin-staff-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-staff-modal';
        modal.className = 'user-profile-modal';
        modal.innerHTML = `
            <div class="user-profile-drawer" style="max-width: 540px; overflow-y: auto;">
                <div class="user-profile-header">
                    <h3 id="staff-modal-title">Add Staff Member</h3>
                    <button class="close-profile-btn" id="close-staff-modal-btn" aria-label="Close">×</button>
                </div>
                <div style="padding: 1.5rem;">
                    <form id="staff-modal-form" novalidate>
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label for="staff-modal-name">Name <span style="color:var(--color-accent)">*</span></label>
                            <input type="text" id="staff-modal-name" placeholder="Full name" required>
                        </div>
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label for="staff-modal-role">Role <span style="color:var(--color-accent)">*</span></label>
                            <input type="text" id="staff-modal-role" list="staff-role-options" placeholder="e.g. Staff Writer" required>
                            <datalist id="staff-role-options">
                                ${STAFF_ROLES.map(r => `<option value="${r}">`).join('')}
                            </datalist>
                        </div>
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label>Photo</label>
                            <div class="avatar-setting-container" style="margin-top: 0.75rem;">
                                <div class="avatar-wrapper">
                                    <div id="staff-modal-preview" class="avatar avatar--large" style="background-color: var(--color-border);"></div>
                                </div>
                                <div class="avatar-actions">
                                    <div style="display:flex; gap: 0.75rem;">
                                        <button type="button" class="button-secondary" id="staff-upload-btn">Upload Photo</button>
                                        <button type="button" class="button-secondary" id="staff-remove-btn" style="display:none;">Remove</button>
                                    </div>
                                    <input type="url" id="staff-modal-image-url" placeholder="Or paste an image URL…" style="margin-top: 0.5rem; width: 100%;">
                                </div>
                            </div>
                            <input type="file" id="staff-modal-image-file" accept="image/*" style="display:none">
                        </div>
                        <div class="form-group" style="margin-bottom: 1.5rem;">
                            <label for="staff-modal-bio">Bio</label>
                            <textarea id="staff-modal-bio" rows="4" placeholder="A short bio about this staff member..." style="width:100%; resize:vertical;"></textarea>
                        </div>
                        <div style="display:flex; gap: 0.75rem; justify-content: flex-end;">
                            <button type="button" class="button-secondary" id="staff-modal-cancel-btn">Cancel</button>
                            <button type="submit" class="button-primary" id="staff-modal-submit-btn">Save</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        setupSmartQuotes(document.getElementById('staff-modal-name'));
        setupSmartQuotes(document.getElementById('staff-modal-role'));
        setupSmartQuotes(document.getElementById('staff-modal-bio'));

        addTrackedListener(document.getElementById('close-staff-modal-btn'), 'click', closeStaffModal);
        addTrackedListener(document.getElementById('staff-modal-cancel-btn'), 'click', closeStaffModal);
        addTrackedListener(modal, 'click', (e) => { if (e.target === modal) closeStaffModal(); });

        const fileInput = document.getElementById('staff-modal-image-file');
        const urlInput = document.getElementById('staff-modal-image-url');
        const uploadBtn = document.getElementById('staff-upload-btn');
        const removeBtn = document.getElementById('staff-remove-btn');

        addTrackedListener(uploadBtn, 'click', () => fileInput.click());

        addTrackedListener(fileInput, 'change', () => {
            const file = fileInput.files[0];
            if (file) {
                openCropper(file, 1, (croppedFile, blob) => {
                    const dt = new DataTransfer();
                    dt.items.add(croppedFile);
                    fileInput.files = dt.files;

                    staffModalSetPreview(URL.createObjectURL(blob));
                    urlInput.value = '';
                    modal.dataset.clearImage = '';
                }, () => {
                    fileInput.value = '';
                });
            }
        });

        addTrackedListener(urlInput, 'input', () => {
            const val = urlInput.value.trim();
            staffModalSetPreview(val || null);
            if (val) {
                fileInput.value = '';
                modal.dataset.clearImage = '';
            }
        });

        addTrackedListener(removeBtn, 'click', () => {
            fileInput.value = '';
            urlInput.value = '';
            staffModalSetPreview(null);
            modal.dataset.clearImage = 'true';
        });
    }

    const titleEl = document.getElementById('staff-modal-title');
    const nameInput = document.getElementById('staff-modal-name');
    const roleInput = document.getElementById('staff-modal-role');
    const bioInput = document.getElementById('staff-modal-bio');
    const fileInput = document.getElementById('staff-modal-image-file');
    const urlInput = document.getElementById('staff-modal-image-url');
    const form = document.getElementById('staff-modal-form');

    // Reset form
    modal.dataset.clearImage = '';
    fileInput.value = '';
    form.onsubmit = null;

    if (member) {
        titleEl.textContent = 'Edit Staff Member';
        nameInput.value = member.name || '';
        roleInput.value = member.role || '';
        bioInput.value = member.bio || '';
        if (member.image) {
            const resolvedSrc = member.image.startsWith('data/') ? `/${member.image}` : member.image;
            staffModalSetPreview(resolvedSrc);
            urlInput.value = member.image.startsWith('data/') ? '' : member.image;
        } else {
            staffModalSetPreview(null);
            urlInput.value = '';
        }
    } else {
        titleEl.textContent = 'Add Staff Member';
        nameInput.value = '';
        roleInput.value = '';
        bioInput.value = '';
        urlInput.value = '';
        staffModalSetPreview(null);
    }

    form.onsubmit = async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const role = roleInput.value.trim();
        if (!name || !role) {
            showError('Name and role are required.');
            return;
        }

        const submitBtn = document.getElementById('staff-modal-submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const formData = new FormData();
        formData.append('name', name);
        formData.append('role', role);
        formData.append('bio', bioInput.value.trim());

        const file = fileInput.files[0];
        if (file) {
            formData.append('image', file);
        } else {
            const urlVal = urlInput.value.trim();
            formData.append('imageUrl', urlVal);
        }

        if (modal.dataset.clearImage === 'true') {
            formData.append('clearImage', 'true');
        }

        let result;
        if (member !== null) {
            result = await updateAdminStaff(member.id, formData);
        } else {
            result = await createAdminStaff(formData);
        }

        submitBtn.disabled = false;
        submitBtn.textContent = 'Save';

        if (result.success) {
            showSuccess(member ? 'Staff member updated.' : 'Staff member added.');
            closeStaffModal();
            loadAdminStaff();
        } else {
            showError(result.error || 'Something went wrong.');
        }
    };

    modal.style.display = 'flex';
    setTimeout(() => nameInput.focus(), 50);
}

function closeStaffModal() {
    const modal = document.getElementById('admin-staff-modal');
    if (modal) modal.style.display = 'none';
}

async function loadAdminStaff() {
    const container = document.getElementById('admin-staff-container');
    if (!container) return;

    container.innerHTML = '<div class="loader-inline"></div>';
    let staffList = await getAdminStaff();

    async function moveStaffMember(id, direction) {
        const currentIndex = staffList.findIndex(member => member.id === id);
        const nextIndex = currentIndex + direction;
        if (currentIndex === -1 || nextIndex < 0 || nextIndex >= staffList.length) return;

        const nextStaffList = [...staffList];
        [nextStaffList[currentIndex], nextStaffList[nextIndex]] = [nextStaffList[nextIndex], nextStaffList[currentIndex]];
        container.classList.add('admin-loading-state');
        const result = await reorderAdminStaff(nextStaffList.map(member => member.id));
        container.classList.remove('admin-loading-state');

        if (result.success) {
            const currentRow = container.querySelector(`tr[data-staff-id="${id}"]`);
            const targetRow = container.querySelector(`tr[data-staff-id="${staffList[nextIndex].id}"]`);
            if (currentRow && targetRow) {
                const tbody = currentRow.parentElement;
                if (direction < 0) {
                    tbody.insertBefore(currentRow, targetRow);
                } else {
                    tbody.insertBefore(targetRow, currentRow);
                }
            }
            staffList = nextStaffList;
            updateStaffMoveButtons();
        } else {
            showError(result.error || 'Failed to update staff order.');
        }
    }

    function updateStaffMoveButtons() {
        staffList.forEach((member, index) => {
            const row = container.querySelector(`tr[data-staff-id="${member.id}"]`);
            if (!row) return;
            row.querySelector('.staff-move-btn[data-direction="-1"]').disabled = index === 0;
            row.querySelector('.staff-move-btn[data-direction="1"]').disabled = index === staffList.length - 1;
        });
    }

    if (staffList.length === 0) {
        container.innerHTML = '<p class="empty-state-text">No staff members yet. Click "+ Add Staff Member" to get started.</p>';
    } else {
        container.innerHTML = `
            <div class="users-table-wrapper">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th style="width:96px;">Order</th>
                            <th style="width:56px;"></th>
                            <th>Name</th>
                            <th>Role</th>
                            <th>Bio</th>
                            <th class="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${staffList.map((member, index) => {
                            const imgSrc = member.image
                                ? (member.image.startsWith('data/') || member.image.startsWith('uploads/') ? `/${member.image}` : member.image)
                                : '';
                            const bioSnippet = member.bio ? (member.bio.length > 60 ? member.bio.slice(0, 60) + '…' : member.bio) : '<em style="color:var(--color-text-muted)">No bio</em>';
                            const avatarStyle = imgSrc
                                ? `background-image:url('${imgSrc}'); background-color: var(--color-border);`
                                : `background: var(--color-border);`;
                            return `
                            <tr data-staff-id="${member.id}">
                                <td>
                                    <div class="staff-order-controls" aria-label="Change order for ${member.name}">
                                        <button class="button-icon-only staff-move-btn" data-id="${member.id}" data-direction="-1" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
                                        <button class="button-icon-only staff-move-btn" data-id="${member.id}" data-direction="1" title="Move down" ${index === staffList.length - 1 ? 'disabled' : ''}>↓</button>
                                    </div>
                                </td>
                                <td style="width:56px; padding-right:0;">
                                    <div class="avatar avatar--medium" style="${avatarStyle}"></div>
                                </td>
                                <td><strong>${member.name}</strong></td>
                                <td>${member.role}</td>
                                <td style="max-width:200px;">${bioSnippet}</td>
                                <td class="text-right">
                                    <div class="action-btn-group">
                                        <button class="button-icon-only staff-edit-btn" data-id="${member.id}" title="Edit">
                                            ${actionIcons.edit}
                                        </button>
                                        <button class="button-icon-only delete staff-delete-btn" data-id="${member.id}" data-name="${member.name}" title="Delete">
                                            ${actionIcons.trash}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // Attach add button listener
    const addBtn = document.getElementById('admin-add-staff-btn');
    if (addBtn && !addBtn.dataset.listenerAttached) {
        addBtn.dataset.listenerAttached = 'true';
        addTrackedListener(addBtn, 'click', () => openStaffModal(null));
    }

    // Attach edit listeners
    container.querySelectorAll('.staff-move-btn').forEach(btn => {
        addTrackedListener(btn, 'click', () => {
            const id = parseInt(btn.dataset.id, 10);
            const direction = parseInt(btn.dataset.direction, 10);
            moveStaffMember(id, direction);
        });
    });

    container.querySelectorAll('.staff-edit-btn').forEach(btn => {
        addTrackedListener(btn, 'click', () => {
            const id = parseInt(btn.dataset.id, 10);
            const member = staffList.find(m => m.id === id);
            if (member) openStaffModal(member);
        });
    });

    // Attach delete listeners
    container.querySelectorAll('.staff-delete-btn').forEach(btn => {
        addTrackedListener(btn, 'click', async () => {
            const id = parseInt(btn.dataset.id, 10);
            const name = btn.dataset.name;
            if (!confirm(`Remove "${name}" from the staff? This cannot be undone.`)) return;
            const result = await deleteAdminStaff(id);
            if (result.success) {
                showSuccess(`${name} removed from staff.`);
                loadAdminStaff();
            } else {
                showError(result.error || 'Failed to delete staff member.');
            }
        });
    });
}

async function loadAdminContacts(filterQuery = '') {
    const container = document.getElementById('admin-responses-container');
    if (!container) return;

    container.classList.add('admin-loading-state');
    const contacts = await getAdminContacts();
    container.classList.remove('admin-loading-state');

    if (!contacts) {
        container.innerHTML = '<p class="error-message">Failed to load contact submissions.</p>';
        return;
    }

    const filtered = filterQuery
        ? contacts.filter(c =>
            c.name.toLowerCase().includes(filterQuery) ||
            c.email.toLowerCase().includes(filterQuery) ||
            c.message.toLowerCase().includes(filterQuery)
          )
        : contacts;

    if (filtered.length === 0) {
        container.innerHTML = filterQuery
            ? `<p class="empty-state-text">No submissions match "${filterQuery}".</p>`
            : '<p class="empty-state-text">No contact submissions yet.</p>';
        return;
    }

    container.innerHTML = `
        <div class="response-cards-list">
            ${filtered.map(c => `
            <div class="response-card" id="response-card-${c.contact_id}" data-contact-id="${c.contact_id}" data-name="${c.name.toLowerCase()}" data-email="${c.email.toLowerCase()}">
                <div class="response-card-header">
                    <div class="response-card-sender">
                        <span class="response-card-name">${c.name}</span>
                        <span class="response-card-date">${new Date(c.submitted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                    </div>
                    <button class="button-icon-only delete admin-delete-response-btn" data-contact-id="${c.contact_id}" title="Delete submission">
                        ${actionIcons.trash}
                    </button>
                </div>
                <div class="response-card-meta">
                    <a href="mailto:${c.email}">${c.email}</a>
                    ${c.website ? `<span class="response-card-sep">·</span><a href="${c.website}" target="_blank" rel="noopener noreferrer">${c.website}</a>` : ''}
                </div>
                <p class="response-card-message">${c.message}</p>
            </div>`).join('')}
        </div>
    `;
}

function attachAdminNavigation() {
    if (!adminNavigationAttached) {
        adminNavigationAttached = true;
        attachAdminNavigationListeners();
    }

    if (pendingAdminSection) {
        const sectionBtn = document.querySelector(`.admin-tab-link[data-admin-section="${pendingAdminSection}"]`);
        pendingAdminSection = null;
        if (sectionBtn) sectionBtn.click();
    }
}

function attachAdminNavigationListeners() {
    const tabLinks = document.querySelectorAll('.admin-tab-link');
    const sections = document.querySelectorAll('.admin-section');

    tabLinks.forEach(link => {
        addTrackedListener(link, 'click', async (e) => {
            const targetSection = e.currentTarget.dataset.adminSection;

            tabLinks.forEach(l => l.classList.remove('active'));
            e.currentTarget.classList.add('active');

            sections.forEach(s => s.classList.remove('active'));
            const section = document.getElementById(`admin-${targetSection}-section`);
            if (section) {
                section.classList.add('active');

                if (targetSection === 'moderation') {
                    await loadAdminComments(5);
                } else if (targetSection === 'users') {
                    await loadAdminUsers();
                } else if (targetSection === 'content') {
                    await loadAdminArticles();
                } else if (targetSection === 'featured') {
                    await loadAdminFeatured();
                } else if (targetSection === 'issues') {
                    await loadAdminIssues();
                } else if (targetSection === 'staff') {
                    await loadAdminStaff();
                } else if (targetSection === 'responses') {
                    await loadAdminContacts();
                }
            }
        });
    });

    const moderationTabs = document.querySelectorAll('.admin-subtab-btn[data-moderation-tab]');
    moderationTabs.forEach(tab => {
        addTrackedListener(tab, 'click', async (e) => {
            const tabType = e.currentTarget.dataset.moderationTab;

            moderationTabs.forEach(t => t.classList.remove('active'));
            e.currentTarget.classList.add('active');

            const commentSearchInput = document.getElementById('comment-search');
            if (commentSearchInput) commentSearchInput.value = ''; // Clear search on tab switch

            if (tabType === 'recent') {
                await loadAdminComments(5);
            } else if (tabType === 'all') {
                await loadAdminComments(-1);
            }
        });
    });

    const userProfileModal = document.getElementById('user-profile-modal');
    const closeBtn = userProfileModal ? userProfileModal.querySelector('.close-profile-btn') : null;
    if (closeBtn) {
        addTrackedListener(closeBtn, 'click', closeUserProfile);
    }

    if (userProfileModal) {
        addTrackedListener(userProfileModal, 'click', (e) => {
            if (e.target === userProfileModal) {
                closeUserProfile();
            }
        });
    }

}

function attachAdminEventListeners() {
    const adminTab = document.getElementById('admin-tab');
    if (!adminTab) return;

    addTrackedListener(adminTab, 'click', async (e) => {
        const viewUserLink = e.target.closest('.view-user-link');
        if (viewUserLink) {
            const userId = viewUserLink.dataset.userId;
            await showUserProfile(userId);
            return;
        }

        const deleteUserBtn = e.target.closest('.admin-delete-user-btn');
        if (deleteUserBtn) {
            const userId = deleteUserBtn.dataset.userId;
            const row = deleteUserBtn.closest('tr');
            const username = row.dataset.username;

            if (confirm(`Are you sure you want to permanently delete the user "${username}"? This will also delete all their comments and data.`)) {
                const result = await deleteUserByAdmin(userId);
                if (result.error) {
                    showError(result.error);
                } else {
                    showSuccess('User deleted successfully.');
                    row.remove();
                }
            }
            return;
        }

        // --- ARTICLE ACTIONS ---
        const deleteArticleBtn = e.target.closest('.admin-delete-article-btn');
        if (deleteArticleBtn) {
            if (confirm('Are you sure you want to delete this article? This cannot be undone.')) {
                const row = deleteArticleBtn.closest('tr');
                const articleId = row.dataset.articleId;
                const result = await deleteArticle(articleId);

                if (result.success) {
                    showSuccess('Article deleted.');
                    row.remove();
                } else {
                    showError('Failed to delete article.');
                }
            }
            return;
        }

        const toggleFeaturedBtn = e.target.closest('.admin-toggle-featured-btn');
        if (toggleFeaturedBtn) {
            if (toggleFeaturedBtn.disabled) return;
            const articleId = toggleFeaturedBtn.dataset.articleId;
            const currentFeatured = toggleFeaturedBtn.dataset.featured === 'true';

            const result = await toggleArticleFeatured(articleId, currentFeatured);

            if (result.success) {
                const newFeatured = result.featured;
                showSuccess(newFeatured ? 'Article is now featured.' : 'Article removed from featured.');
                await loadAdminFeatured();
            } else {
                showError(result.error || 'Failed to update featured status.');
            }
            return;
        }

        const toggleStatusBtn = e.target.closest('.admin-toggle-status-btn');
        if (toggleStatusBtn) {
            const row = toggleStatusBtn.closest('tr');
            const articleId = row.dataset.articleId;
            const currentStatus = row.dataset.status;

            const result = await toggleArticleStatus(articleId, currentStatus);

            if (result.success) {
                showSuccess(`Article ${result.newStatus.toLowerCase()}.`);

                // Update Row Data
                row.dataset.status = result.newStatus;

                // Update Status Badge UI
                const statusBadge = row.querySelector('.status-badge');
                if (statusBadge) {
                    const isUnpublished = result.newStatus === 'Unpublished';
                    const isScheduled = result.newStatus === 'Scheduled';
                    statusBadge.className = `status-badge ${isScheduled ? 'status-scheduled' : isUnpublished ? 'status-unpublished' : 'status-published'}`;
                    statusBadge.textContent = isScheduled ? 'Scheduled' : isUnpublished ? 'Draft' : 'Live';
                }

                // Update Toggle Button UI
                const btn = row.querySelector('.admin-toggle-status-btn');
                if (btn) {
                    const isUnpublished = result.newStatus === 'Unpublished';
                    const newTitle = isUnpublished ? 'Publish Article' : 'Unpublish Article';
                    const newIcon = isUnpublished ? actionIcons.eyeOff : actionIcons.eye;

                    btn.title = newTitle;
                    btn.innerHTML = newIcon;
                }

            } else {
                showError('Failed to update status.');
            }
            return;
        }

        const editBtn = e.target.closest('.admin-edit-comment-btn');
        if (editBtn) {
            const commentId = editBtn.dataset.commentId;
            document.getElementById(`admin-comment-view-${commentId}`).style.display = 'none';
            document.getElementById(`admin-edit-form-${commentId}`).style.display = 'block';
            return;
        }

        const cancelBtn = e.target.closest('.admin-cancel-edit-btn');
        if (cancelBtn) {
            const commentId = cancelBtn.dataset.commentId;
            document.getElementById(`admin-comment-view-${commentId}`).style.display = 'block';
            document.getElementById(`admin-edit-form-${commentId}`).style.display = 'none';
            return;
        }

        const saveBtn = e.target.closest('.admin-save-edit-btn');
        if (saveBtn) {
            const commentId = saveBtn.dataset.commentId;
            const textarea = document.querySelector(`#admin-edit-form-${commentId} textarea`);
            const newContent = textarea.value.trim();
            if (!newContent) {
                showWarning('Comment cannot be empty.');
                return;
            }
            const result = await editComment(commentId, newContent);
            if (result) {
                document.getElementById(`admin-comment-content-${commentId}`).textContent = `“${newContent}”`;
                document.getElementById(`admin-comment-view-${commentId}`).style.display = 'block';
                document.getElementById(`admin-edit-form-${commentId}`).style.display = 'none';
                showSuccess('Comment updated successfully.');
            } else {
                showError('Failed to update comment.');
            }
            return;
        }

        const deleteCommentBtn = e.target.closest('.admin-delete-comment-btn');
        if (deleteCommentBtn) {
            const commentId = deleteCommentBtn.dataset.commentId;
            if (confirm('Are you sure you want to delete this comment?')) {
                const result = await deleteComment(commentId);
                if (result) {
                    document.getElementById(`admin-comment-${commentId}`).remove();
                    showSuccess('Comment deleted successfully.');
                } else {
                    showError('Failed to delete comment.');
                }
            }
            return;
        }

        const deleteResponseBtn = e.target.closest('.admin-delete-response-btn');
        if (deleteResponseBtn) {
            const contactId = deleteResponseBtn.dataset.contactId;
            if (confirm('Are you sure you want to delete this contact submission?')) {
                const result = await deleteAdminContact(contactId);
                if (result && result.success) {
                    const card = document.getElementById(`response-card-${contactId}`);
                    if (card) card.remove();
                    showSuccess('Submission deleted successfully.');
                    const list = document.querySelector('.response-cards-list');
                    if (list && list.querySelectorAll('.response-card').length === 0) {
                        document.getElementById('admin-responses-container').innerHTML = '<p class="empty-state-text">No contact submissions yet.</p>';
                    }
                } else {
                    showError(result.error || 'Failed to delete submission.');
                }
            }
            return;
        }
    });

    const userSearch = document.getElementById('user-search');
    addTrackedListener(userSearch, 'input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        document.querySelectorAll('#users-table tbody tr').forEach(row => {
            const username = row.dataset.username.toLowerCase();
            row.style.display = username.includes(searchTerm) ? '' : 'none';
        });
    });

    const commentSearch = document.getElementById('comment-search');
    addTrackedListener(commentSearch, 'input', async (e) => {
        const searchTerm = e.target.value.toLowerCase();
        if (searchTerm.length === 0) {
             // Revert to the active tab's default limit
             const activeTab = document.querySelector('.admin-subtab-btn.active[data-moderation-tab]');
             const tabType = activeTab ? activeTab.dataset.moderationTab : 'recent';
             await loadAdminComments(tabType === 'recent' ? 5 : -1);
        } else {
             // Search globally
             await loadAdminComments(-1, searchTerm);
        }
    });

    const articleSearch = document.getElementById('article-search');
    addTrackedListener(articleSearch, 'input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        document.querySelectorAll('#articles-table tbody tr').forEach(row => {
            const title = row.dataset.title.toLowerCase();
            row.style.display = title.includes(searchTerm) ? '' : 'none';
        });
    });

    const responseSearch = document.getElementById('response-search');
    addTrackedListener(responseSearch, 'input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        document.querySelectorAll('.response-card').forEach(card => {
            const name = card.dataset.name || '';
            const email = card.dataset.email || '';
            card.style.display = (name.includes(searchTerm) || email.includes(searchTerm)) ? '' : 'none';
        });
    });

    const articlesSortBy = document.getElementById('articles-sort-by');
    addTrackedListener(articlesSortBy, 'change', (e) => {
        const sortBy = e.target.value;
        const tbody = document.querySelector('#articles-table tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.sort((a, b) => {
            let valA, valB;
            switch (sortBy) {
                case 'date-desc': return new Date(b.dataset.date) - new Date(a.dataset.date);
                case 'date-asc': return new Date(a.dataset.date) - new Date(b.dataset.date);
                case 'title-asc': return a.dataset.title.localeCompare(b.dataset.title);
                case 'title-desc': return b.dataset.title.localeCompare(a.dataset.title);
                case 'likes-desc': return parseInt(b.dataset.likes, 10) - parseInt(a.dataset.likes, 10);
                case 'likes-asc': return parseInt(a.dataset.likes, 10) - parseInt(b.dataset.likes, 10);
                case 'comments-desc': return parseInt(b.dataset.comments, 10) - parseInt(a.dataset.comments, 10);
                case 'comments-asc': return parseInt(a.dataset.comments, 10) - parseInt(b.dataset.comments, 10);
                case 'views-desc': return parseInt(b.dataset.views, 10) - parseInt(a.dataset.views, 10);
                case 'views-asc': return parseInt(a.dataset.views, 10) - parseInt(b.dataset.views, 10);
                default: return 0;
            }
        });
        rows.forEach(row => tbody.appendChild(row));
    });
}

export async function render(container) {
    cleanupEventListeners();

    if (!getIsLoggedIn()) {
        navigate('/login');
        return () => {};
    }

    container.innerHTML = DOMPurify.sanitize(createHTML(null));

    // Wait for auth before trying to fetch protected account data
    await waitForAuth();

    const [accountData, siteData] = await Promise.all([getAccountData(), getCombinedData()]);

    if (!accountData || accountData.error) {
        showError('Could not load account data. Please log in again.');
        navigate('/login');
        return () => {};
    }

    if (!siteData) return () => {}; // null = cache invalidated mid-flight (e.g. logout); page reload follows

    const articleMap = new Map(siteData.articles.map(article => [article.id, article]));
    const getArticlesByIds = (ids) => ids.map(id => articleMap.get(id)).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));
    const commentsWithArticleData = accountData.comments.map(comment => ({
        comment,
        article: articleMap.get(comment.article_id)
    })).filter(item => item.article);
    const likedArticles = getArticlesByIds(accountData.likedArticleIds);
    const bookmarkedArticles = getArticlesByIds(accountData.bookmarkedArticleIds);
    const recentViewIds = [...accountData.viewedArticleIds].reverse().slice(0, 4);
    const viewedArticles = getArticlesByIds(recentViewIds);

    const finalData = {
        user: { ...accountData },
        likedArticles,
        bookmarkedArticles,
        viewedArticles,
        commentsWithArticleData
    };

    container.innerHTML = DOMPurify.sanitize(createHTML(finalData));
    attachEventListeners();

    // Auto-open admin tab if requested by a shortcut link
    const autoTab = sessionStorage.getItem('adminAutoOpenTab');
    if (autoTab) {
        sessionStorage.removeItem('adminAutoOpenTab');
        if (finalData.user.is_admin) {
            pendingAdminSection = autoTab;
            const adminNavBtn = document.querySelector('.account-sidebar-nav-link[data-tab="admin"]');
            if (adminNavBtn) adminNavBtn.click();
        }
    }

    return () => {
        cleanupEventListeners();
        dashboardChartData = null;
        currentChartIndex = 0;
    };
}
