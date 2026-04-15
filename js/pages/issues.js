import { SortControl } from '../components/common/SortControl.js';
import { sortItems } from '../lib/sorting.js';
import { renderList } from '../lib/template.js';
import { getCurrentUser } from '../lib/auth.js';
import { toRootRelativePath } from '../lib/paths.js';

let issuesToDisplay = [];

function IssueCard(issue) {
    const imageName = issue.filename.replace('.pdf', '.jpg');
    const imageUrl = toRootRelativePath(`assets/images/issue-covers/${imageName}`);
    const pdfUrl = toRootRelativePath(`data/issues/pdfs/${issue.filename}`);
    return `
        <div class="issue-card">
            <div>
                <div class="issue-cover">
                    <img src="${imageUrl}" alt="${issue.name} cover" loading="lazy" onerror="this.src='/assets/icons/placeholder-image.svg'">
                </div>
                <h4>${issue.name}</h4>
            </div>
            <div class="issue-actions">
                <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="issue-btn view-btn">View</a>
                <button class="issue-btn download-btn" data-url="${pdfUrl}" data-filename="${issue.filename}">Download</button>
            </div>
        </div>
    `;
}

function attachSortListener() {
    const sortSelect = document.getElementById('sort-by');
    const listContainer = document.getElementById('issue-list-container');

    if (!sortSelect || !listContainer) return;

    sortSelect.addEventListener('change', (e) => {
        const sortBy = e.target.value;
        const sortedIssues = sortItems(issuesToDisplay, sortBy);
        const listHTML = renderList(sortedIssues, IssueCard);

        listContainer.innerHTML = DOMPurify.sanitize(listHTML, {
            ADD_ATTR: ['target', 'rel']
        });
    });
}

function createHTML(issues, isAdmin) {
    const issueCards = renderList(issues, IssueCard);
    const adminBarHTML = isAdmin ? `
        <div class="article-admin-bar" style="max-width: 750px; margin: 0 auto 2rem auto; text-align: left;">
            <span class="article-admin-bar__label">Admin</span>
            <a href="/account" id="issues-manage-btn" class="article-admin-bar__edit-btn" title="Manage Issues in Admin Panel">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Manage Issues
            </a>
        </div>
    ` : '';
    return `
        <section class="page" id="issues-page">
            <div class="container">
                <div class="page-header">
                    ${adminBarHTML}
                    <h1>Past Issues</h1>
                    <p>Browse and download PDF versions of our print newspaper. Perfect for offline reading or seeing our layout design.</p>
                </div>
                ${SortControl()}
                <div id="issue-list-container" class="issue-list">${issueCards}</div>
            </div>
        </section>
    `;
}

export async function render(container) {
    try {
        const response = await fetch('/api/issues');
        if (!response.ok) throw new Error('Failed to fetch issues data.');

        const issues = await response.json();

        issuesToDisplay = issues.map(issue => ({ ...issue, title: issue.name }));

        const initiallySortedIssues = sortItems(issuesToDisplay, 'date-desc');

        const currentUser = getCurrentUser();
        const isAdmin = currentUser && currentUser.is_admin;

        container.innerHTML = DOMPurify.sanitize(createHTML(initiallySortedIssues, isAdmin), {
            ADD_ATTR: ['target', 'rel']
        });

        const manageIssuesBtn = document.getElementById('issues-manage-btn');
        if (manageIssuesBtn) {
            manageIssuesBtn.addEventListener('click', () => {
                sessionStorage.setItem('adminAutoOpenTab', 'issues');
            });
        }

        attachSortListener();

    } catch (error) {
        console.error("Error rendering issues page:", error);
        container.innerHTML = `<div class="container page"><p>Could not load issues. Please try again later.</p></div>`;
    }
}
