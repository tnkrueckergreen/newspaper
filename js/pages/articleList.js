import { getCombinedData, getCachedArticleList } from '../lib/api.js';
import { SortControl } from '../components/common/SortControl.js';
import { sortItems } from '../lib/sorting.js';
import { renderList } from '../lib/template.js';
import { SmallCard } from '../components/cards/SmallCard.js';
import { getCurrentUser } from '../lib/auth.js';

const PAGE_SIZE = 20;

let articlesToDisplay = [];
let currentPage = 1;

function renderLoadMoreButton(container, total) {
    const existing = document.querySelector('.load-more-wrapper');
    if (existing) existing.remove();

    const shown = currentPage * PAGE_SIZE;
    if (shown >= total) return;

    const btn = document.createElement('div');
    btn.className = 'load-more-wrapper';
    btn.innerHTML = `<button id="load-more-btn" class="load-more-btn">Load More (${total - shown} remaining)</button>`;
    container.parentElement.appendChild(btn);

    document.getElementById('load-more-btn').addEventListener('click', () => {
        currentPage++;
        const nextBatch = articlesToDisplay.slice(0, currentPage * PAGE_SIZE);
        const gridContainer = document.getElementById('article-grid-container');
        if (gridContainer) {
            gridContainer.innerHTML = DOMPurify.sanitize(renderList(nextBatch, SmallCard));
        }
        renderLoadMoreButton(container, total);
    });
}

function createHTML(title, articles, isAdmin) {
    const firstPage = articles.slice(0, currentPage * PAGE_SIZE);
    const articleCards = renderList(firstPage, SmallCard);
    const adminBarHTML = isAdmin ? `
        <div class="article-admin-bar" style="max-width: 750px; margin: 0 auto 2rem auto; text-align: left;">
            <span class="article-admin-bar__label">Admin</span>
            <a href="/account" id="articles-manage-btn" class="article-admin-bar__edit-btn" title="Manage Articles in Admin Panel">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Manage Articles
            </a>
        </div>
    ` : '';

    return `
        <section class="page article-grid-page">
            <div class="container">
                <div class="page-header">
                    ${adminBarHTML}
                    <h1>${title}</h1>
                </div>
                ${SortControl()}
                <div id="article-grid-container" class="article-grid">${articleCards}</div>
            </div>
        </section>
    `;
}

function attachSortListener(total) {
    const sortSelect = document.getElementById('sort-by');
    const gridContainer = document.getElementById('article-grid-container');

    if (!sortSelect || !gridContainer) return;

    sortSelect.addEventListener('change', (e) => {
        const sortBy = e.target.value;
        articlesToDisplay = sortItems(articlesToDisplay, sortBy);
        currentPage = 1;
        const firstPage = articlesToDisplay.slice(0, PAGE_SIZE);
        gridContainer.innerHTML = DOMPurify.sanitize(renderList(firstPage, SmallCard));
        renderLoadMoreButton(gridContainer, total);
    });
}

function filterAndSort(articles, filterValue, filterType) {
    let filtered = [];
    let title = '';

    if (filterType === 'author') {
        const authorName = decodeURIComponent(filterValue);
        filtered = articles.filter(article => 
            article.writers.some(writer => writer.name === authorName)
        );
        title = `Articles by ${authorName}`;
    } else { 
        const category = filterValue.toLowerCase();
        if (category === 'all') {
            filtered = articles;
            title = 'All Articles';
        } else if (category === 'opinion') {
            filtered = articles.filter(a => 
                a.categories.some(c => ['opinion', 'editorial'].includes(c.toLowerCase()))
            );
            title = 'Opinion';
        } else {
            filtered = articles.filter(a => 
                a.categories.map(c => c.toLowerCase()).includes(category)
            );
            title = filterValue.charAt(0).toUpperCase() + filterValue.slice(1);
        }
    }
    return { 
        articles: sortItems(filtered, 'date-desc'),
        title 
    };
}

export async function render(container, filterValue = 'all', filterType = 'category') {
    currentPage = 1;

    const currentUser = getCurrentUser();
    const isAdmin = currentUser && currentUser.is_admin;

    const attachAdminListener = () => {
        const manageArticlesBtn = document.getElementById('articles-manage-btn');
        if (manageArticlesBtn) {
            manageArticlesBtn.addEventListener('click', () => {
                sessionStorage.setItem('adminAutoOpenTab', 'content');
            });
        }
    };

    const renderContent = (data) => {
        const result = filterAndSort(data.articles, filterValue, filterType);
        articlesToDisplay = result.articles;
        container.innerHTML = DOMPurify.sanitize(createHTML(result.title, result.articles, isAdmin));
        const gridContainer = document.getElementById('article-grid-container');
        attachSortListener(result.articles.length);
        if (gridContainer) renderLoadMoreButton(gridContainer, result.articles.length);
        attachAdminListener();
    };

    // 1. Instant Cache
    const cachedData = getCachedArticleList();
    if (cachedData) {
        renderContent(cachedData);
    }

    // 2. Network Fetch
    try {
        const data = await getCombinedData();
        if (!data) return;
        if (!cachedData) {
            renderContent(data);
        }
    } catch (e) {
        if (!cachedData) {
             container.innerHTML = '<div class="container"><p>Failed to load articles.</p></div>';
        }
    }
}
