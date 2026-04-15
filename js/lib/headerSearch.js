import { performSearch } from './search.js';
import { navigate } from './router.js';

function debounce(func, delay = 300) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

export function initHeaderSearch() {
    const searchIconBtn = document.getElementById('search-icon-btn');
    const searchContainer = document.getElementById('header-search-container');
    const headerSearchForm = document.getElementById('header-search-form');
    const headerSearchInput = document.getElementById('header-search-input');
    const headerSearchClearBtn = document.getElementById('header-search-clear-btn');
    const headerSearchGoBtn = document.getElementById('header-search-go-btn');
    const headerSearchResults = document.getElementById('header-search-results');

    let selectedIndex = -1;

    const renderResults = (results) => {
        selectedIndex = -1;
        headerSearchResults.innerHTML = '';
        if (results.length === 0) {
            headerSearchResults.classList.remove('is-visible');
            return;
        }

        const fragment = document.createDocumentFragment();
        results.slice(0, 4).forEach(article => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = `/article/${article.id}`;

            const titleSpan = document.createElement('span');
            titleSpan.className = 'search-result-title';
            titleSpan.textContent = article.title;

            const categorySpan = document.createElement('span');
            categorySpan.className = 'search-result-category';
            categorySpan.textContent = article.category;

            a.appendChild(titleSpan);
            a.appendChild(categorySpan);
            li.appendChild(a);
            fragment.appendChild(li);
        });
        headerSearchResults.appendChild(fragment);
        headerSearchResults.classList.add('is-visible');
    };

    const updateHighlight = () => {
        const items = headerSearchResults.querySelectorAll('li');
        items.forEach((item, index) => {
            item.classList.toggle('is-highlighted', index === selectedIndex);
        });
    };

    const handleSearch = async () => {
        const query = headerSearchInput.value.trim();
        headerSearchClearBtn.classList.toggle('visible', query.length > 0);
        headerSearchGoBtn.disabled = query.length === 0;

        if (query.length < 2) {
            renderResults([]);
            return;
        }

        const results = await performSearch(query);
        renderResults(results);
    };

    const debouncedSearch = debounce(handleSearch, 300);

    const openSearch = () => {
        document.body.classList.add('search-active');
        headerSearchInput.focus();
    };

    const closeSearch = () => {
        document.body.classList.remove('search-active');
        headerSearchInput.value = '';
        renderResults([]);
        headerSearchClearBtn.classList.remove('visible');
        if (headerSearchGoBtn) headerSearchGoBtn.disabled = true;
    };

    searchIconBtn.addEventListener('click', () => {
        if (document.body.classList.contains('search-active')) {
            closeSearch();
        } else {
            openSearch();
        }
    });

    headerSearchInput.addEventListener('input', debouncedSearch);

    headerSearchInput.addEventListener('keydown', (e) => {
        const items = headerSearchResults.querySelectorAll('li');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            updateHighlight();
        } else if (e.key === 'Enter') {
            if (selectedIndex > -1) {
                e.preventDefault();
                items[selectedIndex].querySelector('a').click();
            }
        } else if (e.key === 'Escape') {
            headerSearchResults.classList.remove('is-visible');
        }
    });

    headerSearchClearBtn.addEventListener('click', () => {
        headerSearchInput.value = '';
        handleSearch();
        headerSearchInput.focus();
    });

    headerSearchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = headerSearchInput.value.trim();
        if (query) {
            navigate(`/search/${encodeURIComponent(query)}`);
            closeSearch();
        }
    });

    headerSearchResults.addEventListener('click', (e) => {
        if (e.target.closest('a')) {
            setTimeout(closeSearch, 50);
        }
    });

    document.body.addEventListener('click', (e) => {
        if (!searchContainer.contains(e.target)) {
            headerSearchResults.classList.remove('is-visible');
        }
    });

    return closeSearch;
}