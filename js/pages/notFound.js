import { Container } from '../components/layout/Container.js';
import { Section } from '../components/layout/Section.js';

function createHTML(unpublishedArticle = null) {
    const standardMessage = `We couldn't find the page you were looking for. It may have been moved, archived, or simply doesn't exist.`;

    // If it's an admin looking at an unpublished article, change the UI
    const adminMessage = unpublishedArticle 
        ? `This article exists but is currently <strong>Unpublished</strong>. As an administrator, you have clearance to view it.`
        : standardMessage;

    const title = unpublishedArticle ? "Confidential Content Detected" : "This Story is Off the Record";
    const code = unpublishedArticle ? "403" : "404";
    const label = unpublishedArticle ? "Restricted Access" : "Page Not Found";

    const extraButton = unpublishedArticle 
        ? `<button id="admin-view-secret-btn" class="button-primary" style="background-color: #4f46e5; border-color: #4f46e5;">Let me in!</button>`
        : `<a href="/" class="button-primary">Back to Home</a>`;

    return `
        <div class="not-found-content">
            <div class="not-found-visual">
                <span class="huge-404">${code}</span>
                <span class="not-found-label">${label}</span>
            </div>

            <h1>${title}</h1>
            <p>${adminMessage}</p>

            <div class="not-found-actions">
                ${extraButton}
                <a href="/articles/all" class="button-secondary">Browse Articles</a>
            </div>
        </div>
    `;
}

export function render(container, unpublishedArticle = null, onReveal = null) {
    const content = Container(createHTML(unpublishedArticle));
    const sectionHTML = Section({
        className: 'page not-found-page',
        content
    });

    container.innerHTML = DOMPurify.sanitize(sectionHTML);

    if (unpublishedArticle && onReveal) {
        const btn = document.getElementById('admin-view-secret-btn');
        if (btn) {
            btn.addEventListener('click', () => onReveal(unpublishedArticle));
        }
    }
}