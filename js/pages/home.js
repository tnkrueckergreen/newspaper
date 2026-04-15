import { getCombinedData, getCachedArticleList } from '../lib/api.js';
import { FeaturedCard } from '../components/cards/FeaturedCard.js';
import { RecentCard } from '../components/cards/RecentCard.js';
import { renderList } from '../lib/template.js';

let resizeTimer;
const SCROLL_SPEED = 60;

function populateTicker(articles) {
    const tickerContainer = document.getElementById('news-ticker-container');
    const tickerWrap = tickerContainer?.querySelector('.ticker-wrap');
    const tickerList = tickerContainer?.querySelector('#news-ticker-list');

    if (!tickerContainer || !tickerWrap || !tickerList || articles.length === 0) return null;

    const setupTicker = () => {
        tickerList.innerHTML = '';
        tickerList.classList.remove('is-animated');
        tickerList.style.animation = 'none';

        const originalGroup = document.createElement('div');
        originalGroup.classList.add('ticker-group');
        articles.slice(0, 8).forEach(article => {
            const link = document.createElement('a');
            link.href = `/article/${article.id}`;
            link.textContent = article.title;
            originalGroup.appendChild(link);
        });
        tickerList.appendChild(originalGroup);

        const containerWidth = tickerWrap.offsetWidth;
        const contentWidth = originalGroup.offsetWidth;

        if (contentWidth > containerWidth) {
            const clone = originalGroup.cloneNode(true);
            tickerList.appendChild(clone);
        } else {
            const copiesNeeded = Math.ceil((containerWidth * 2) / contentWidth);
            for (let i = 0; i < copiesNeeded; i++) {
                const clone = originalGroup.cloneNode(true);
                tickerList.appendChild(clone);
            }
        }

        const totalWidth = originalGroup.offsetWidth;
        const duration = totalWidth / SCROLL_SPEED;

        tickerList.style.setProperty('--scroll-width', `${totalWidth}px`);
        tickerList.style.setProperty('--scroll-duration', `${duration}s`);

        requestAnimationFrame(() => {
            tickerList.classList.add('is-animated');
            tickerList.style.animation = '';
        });
    };

    setupTicker();

    const handleResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(setupTicker, 250);
    };

    window.addEventListener('resize', handleResize);

    return () => {
        window.removeEventListener('resize', handleResize);
        clearTimeout(resizeTimer);
    };
}

function initTypewriterEffect() {
    const heading = document.querySelector('.typewriter-heading');
    if (!heading || heading.dataset.isTyped) return null;

    const originalText = heading.textContent;
    heading.dataset.isTyped = 'true';
    heading.style.visibility = 'hidden';
    const finalHeight = heading.offsetHeight;
    heading.style.minHeight = `${finalHeight}px`;
    heading.innerHTML = '';
    heading.style.visibility = 'visible';

    const cursor = document.createElement('span');
    cursor.className = 'typewriter-cursor';
    cursor.textContent = '|';
    heading.appendChild(cursor);

    let charIndex = 0;
    let typingTimeout;
    let blinkInterval;

    function typeCharacter() {
        if (charIndex < originalText.length) {
            const char = originalText[charIndex];
            cursor.insertAdjacentText('beforebegin', char);
            charIndex++;

            const typingSpeed = 50 + (Math.random() * 30 - 15);
            const pause = (char === ',' || char === '.') ? 300 : 0;

            typingTimeout = setTimeout(typeCharacter, typingSpeed + pause);
        } else {
            blinkInterval = setInterval(() => {
                cursor.style.opacity = (cursor.style.opacity === '0') ? '1' : '0';
            }, 500);
        }
    }

    typingTimeout = setTimeout(typeCharacter, 300);

    return () => {
        clearTimeout(typingTimeout);
        clearInterval(blinkInterval);
    };
}


function createHTML(featuredArticles, recentArticles) {
    const featuredCards = renderList(featuredArticles, FeaturedCard);
    const recentCards = renderList(recentArticles, RecentCard);

    return `
        <div class="page" id="home-page">
            <div class="container">
                <section class="welcome-section">
                    <h1 class="typewriter-heading">News, features, and perspectives from the students of Andover High.</h1>
                </section>
                <hr class="main-divider">
            </div>
            <main class="container content-grid">
                <div class="featured-column">
                    <h2 class="section-title">Featured</h2>
                    <div class="featured-articles-wrapper">${featuredCards}</div>
                </div>
                <div class="recent-column">
                    <h2 class="section-title">Recent</h2>
                    <div class="recent-grid">${recentCards}</div>
                </div>
            </main>
        </div>
    `;
}

function processDataAndRender(data, container) {
    const featuredArticles = data.articles.filter(a => a.featured === true).slice(0, 2);
    const recentArticles = data.articles.filter(a => !a.featured).slice(0, 6);
    container.innerHTML = DOMPurify.sanitize(createHTML(featuredArticles, recentArticles));

    // Return setup functions for cleanup later
    const cleanupTicker = populateTicker(data.articles);
    const cleanupTypewriter = initTypewriterEffect();
    return { cleanupTicker, cleanupTypewriter };
}

export function render(container) {
    let alive = true;

    // 1. Instant Render from Cache
    let cleanupFns = {};
    const cachedData = getCachedArticleList();
    if (cachedData) {
        cleanupFns = processDataAndRender(cachedData, container);
    }

    // 2. Network Fetch & Update — run in background so the cleanup function is
    //    returned synchronously. This lets the router store it immediately, so
    //    setting alive = false works even before getCombinedData() resolves.
    getCombinedData().then(data => {
        if (!alive) return;
        if (!data) return; // null = cache invalidated mid-flight (e.g. logout); page reload follows
        if (!cachedData) {
            cleanupFns = processDataAndRender(data, container);
        }
    }).catch(e => {
        if (!alive) return;
        if (!cachedData) {
            container.innerHTML = '<div class="container"><p>Failed to load content.</p></div>';
        }
    });

    return () => {
        alive = false;
        if (cleanupFns.cleanupTicker) cleanupFns.cleanupTicker();
        if (cleanupFns.cleanupTypewriter) cleanupFns.cleanupTypewriter();
    };
}