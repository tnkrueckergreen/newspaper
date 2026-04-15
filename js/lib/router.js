import { render as renderHome } from '../pages/home.js';
import { render as renderAbout } from '../pages/about.js';
import { render as renderArticleList } from '../pages/articleList.js';
import { render as renderSingleArticle } from '../pages/singleArticle.js';
import { render as renderIssues } from '../pages/issues.js';
import { render as renderSearchResults } from '../pages/searchResults.js';
import { render as renderSubscribe } from '../pages/subscribe.js';
import { render as renderContact } from '../pages/contact.js';
import { render as renderWriteForUs } from '../pages/writeForUs.js';
import { render as renderLogin } from '../pages/login.js';
import { render as renderSignup } from '../pages/signup.js';
import { render as renderAccount } from '../pages/account.js';
import { render as renderAdminCreatePost } from '../pages/adminCreatePost.js';
import { render as renderNotFound } from '../pages/notFound.js';
import { render as renderForgotPassword } from '../pages/forgotPassword.js';
import { render as renderResetPassword } from '../pages/resetPassword.js';

const mainContent = document.getElementById('main-content');
const footerCTA = document.getElementById('footer-cta');
const newsTicker = document.getElementById('news-ticker-container');

let currentCleanup = null;
let routeGeneration = 0;

const routes = {
    'home-page': () => renderHome(mainContent),
    'about-page': () => renderAbout(mainContent),
    'contact': () => renderContact(mainContent),
    'write-for-us': () => renderWriteForUs(mainContent),
    'articles-page-all': () => renderArticleList(mainContent, 'all', 'category'),
    'articles-page-community': () => renderArticleList(mainContent, 'community', 'category'),
    'articles-page-sports': () => renderArticleList(mainContent, 'sports', 'category'),
    'articles-page-arts': () => renderArticleList(mainContent, 'arts', 'category'),
    'articles-page-reviews': () => renderArticleList(mainContent, 'reviews', 'category'),
    'articles-page-opinion': () => renderArticleList(mainContent, 'opinion', 'category'),
    'articles-page-editorial': () => renderArticleList(mainContent, 'editorial', 'category'),
    'articles-page-letter-to-the-editor': () => renderArticleList(mainContent, 'Letter to the Editor', 'category'),
    'issues-page': () => renderIssues(mainContent),
    'subscribe': () => renderSubscribe(mainContent),
    'login': () => renderLogin(mainContent),
    'signup': () => renderSignup(mainContent),
    'account': () => renderAccount(mainContent),
    'admin-create-post': () => renderAdminCreatePost(mainContent),
    'admin-edit-post': (param) => renderAdminCreatePost(mainContent, param),
    'forgot-password': () => renderForgotPassword(mainContent),
    'reset-password': (param) => renderResetPassword(mainContent, param),
    'search': (param) => renderSearchResults(mainContent, param),
    'single-article-page': (param) => renderSingleArticle(mainContent, param),
    'author': (param) => renderArticleList(mainContent, param, 'author'),
    '404': () => renderNotFound(mainContent),
};

// Maps clean URL paths to route keys (exact matches)
const exactPathToRoute = {
    '/': 'home-page',
    '/about': 'about-page',
    '/contact': 'contact',
    '/write-for-us': 'write-for-us',
    '/articles/all': 'articles-page-all',
    '/articles/community': 'articles-page-community',
    '/articles/sports': 'articles-page-sports',
    '/articles/arts': 'articles-page-arts',
    '/articles/reviews': 'articles-page-reviews',
    '/articles/opinion': 'articles-page-opinion',
    '/articles/editorial': 'articles-page-editorial',
    '/articles/letter-to-the-editor': 'articles-page-letter-to-the-editor',
    '/issues': 'issues-page',
    '/subscribe': 'subscribe',
    '/login': 'login',
    '/signup': 'signup',
    '/account': 'account',
    '/admin/create': 'admin-create-post',
    '/forgot-password': 'forgot-password',
    '/404': '404',
};

// Maps URL prefixes to route keys (parameterised routes)
const prefixToRoute = [
    { prefix: '/article/', routeKey: 'single-article-page' },
    { prefix: '/admin/edit/', routeKey: 'admin-edit-post' },
    { prefix: '/reset-password/', routeKey: 'reset-password' },
    { prefix: '/search/', routeKey: 'search' },
    { prefix: '/author/', routeKey: 'author' },
];

function getRouteAndParams(pathname) {
    const exact = exactPathToRoute[pathname];
    if (exact) return { path: exact, param: '' };

    for (const { prefix, routeKey } of prefixToRoute) {
        if (pathname.startsWith(prefix)) {
            return { path: routeKey, param: pathname.slice(prefix.length) };
        }
    }

    return { path: '404', param: '' };
}

function updateActiveNavLink(path) {
    const navLinks = document.querySelectorAll('.main-nav a.nav-link');
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        const linkRoute = exactPathToRoute[href] || '';
        let isActive = (linkRoute === path);
        if (path === 'home-page' && href === '/') isActive = true;
        if ((path === 'articles-page-editorial' || path === 'articles-page-letter-to-the-editor') && linkRoute === 'articles-page-opinion') isActive = true;
        if (path === 'articles-page-reviews' && linkRoute === 'articles-page-arts') isActive = true;
        if ((path === 'contact' || path === 'write-for-us') && linkRoute === 'about-page') isActive = true;
        link.classList.toggle('active-link', isActive);
    });
}

export async function handleRouteChange() {
    const myGeneration = ++routeGeneration;

    if (currentCleanup && typeof currentCleanup === 'function') {
        currentCleanup();
        currentCleanup = null;
    }

    const { path, param } = getRouteAndParams(location.pathname);

    updateActiveNavLink(path);

    if (path === 'account') {
        document.body.classList.add('no-scroll');
    } else {
        document.body.classList.remove('no-scroll');
    }

    const currentPath = location.pathname;
    if (path === 'login' || path === 'signup') {
        const previousPath = sessionStorage.getItem('previousPath') || '/';
        if (previousPath !== '/login' && previousPath !== '/signup' && !previousPath.startsWith('/forgot-password') && !previousPath.startsWith('/reset-password')) {
            sessionStorage.setItem('returnToAfterAuth', previousPath);
            sessionStorage.setItem('scrollPositionBeforeAuth', window.scrollY.toString());
        }
    } else {
        sessionStorage.setItem('previousPath', currentPath);
    }

    if (newsTicker) {
        newsTicker.style.display = (path === 'home-page') ? 'flex' : 'none';
    }

    const renderFunction = routes[path];

    if (renderFunction) {
        const result = await renderFunction(param);

        if (myGeneration !== routeGeneration) return;

        if (typeof result === 'function') {
            currentCleanup = result;
        }
    } else {
        navigate('/404');
        return;
    }

    if (footerCTA) {
        const pagesToHideFooterOn = ['subscribe', 'login', 'signup', 'contact', 'account', 'admin-create-post', 'admin-edit-post', 'forgot-password', 'reset-password', '404'];
        footerCTA.classList.toggle('hidden', pagesToHideFooterOn.includes(path));
    }

    window.scrollTo(0, 0);
}

export function navigate(path) {
    history.pushState({}, '', path);
    handleRouteChange();
}

export function initRouter() {
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    window.addEventListener('popstate', handleRouteChange);
    handleRouteChange();
}
