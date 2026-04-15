// andoverview/sw.js
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `andoverview-static-${CACHE_VERSION}`;
const API_CACHE = `andoverview-api-${CACHE_VERSION}`;

const CODE_EXTENSIONS = /\.(js|css)$/i;
const ASSET_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|ico)(\?.*)?$/i;

const PRECACHE_URLS = [
    '/css/main.css',
    '/js/lib/app.js',
    '/js/lib/router.js',
    '/js/lib/api.js',
    '/js/lib/auth.js',
    '/js/lib/template.js',
    '/js/lib/formatters.js',
    '/js/ui/authUI.js',
    '/js/pages/home.js',
    '/js/pages/articleList.js',
    '/js/pages/singleArticle.js',
    '/assets/images/logo.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            return cache.addAll(PRECACHE_URLS).catch((err) => {
                console.warn('[SW] Precache partial failure:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Allow the main thread to signal auth events (e.g. logout) so we can drop
// the API cache before a new session sees another user's private data.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CLEAR_API_CACHE') {
        caches.delete(API_CACHE);
    }
});

// Returns true if the response must not be stored in a shared cache.
// Covers private/no-store (confidential data) and no-cache (must revalidate
// before reuse — caching it defeats the directive entirely).
function isPrivateResponse(response) {
    const cc = response.headers.get('Cache-Control') || '';
    return cc.includes('private') || cc.includes('no-store') || cc.includes('no-cache');
}

// Parse max-age from a Cache-Control header, falling back to `fallback` seconds.
function parseMaxAge(response, fallback) {
    const cc = response.headers.get('Cache-Control') || '';
    const match = cc.match(/\bmax-age=(\d+)/);
    return match ? parseInt(match[1], 10) : fallback;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;

    if (url.pathname.startsWith('/api/articles/')) {
        const segments = url.pathname.split('/');
        const action = segments[4];
        if (!action) {
            event.respondWith(networkFirstWithCache(event, request, API_CACHE, 300));
            return;
        }
    }

    if (url.pathname === '/api/articles' && !url.search) {
        event.respondWith(networkFirstWithCache(event, request, API_CACHE, 300));
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        return;
    }

    if (CODE_EXTENSIONS.test(url.pathname)) {
        event.respondWith(networkFirstWithCache(event, request, STATIC_CACHE, 86400));
        return;
    }

    if (ASSET_EXTENSIONS.test(url.pathname)) {
        // cache-first is still perfect for images, fonts, and icons
        event.respondWith(cacheFirstWithNetwork(event, request, STATIC_CACHE));
        return;
    }

    // HTML navigation: use network-only so users never get a stale shell.
    // The server sends Cache-Control: no-store for index.html and we honour it.
    if (url.pathname === '/' || !url.pathname.includes('.')) {
        event.respondWith(networkOnlyWithOfflineFallback(request, STATIC_CACHE));
        return;
    }
});

async function cacheFirstWithNetwork(event, request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const clone = response.clone();
            // Do not await the cache write. This prevents large payloads from
            // delaying the response to the user, and isolates the response 
            // from QuotaExceeded errors if the cache fills up.
            event.waitUntil(
                caches.open(cacheName)
                    .then(cache => cache.put(request, clone))
                    .catch(cacheErr => console.warn('[SW] Cache write skipped:', cacheErr))
            );
        }
        return response;
    } catch (err) {
        return new Response('Network error', { status: 503 });
    }
}

async function networkFirstWithCache(event, request, cacheName, maxAgeSeconds = 3600) {
    try {
        const response = await fetch(request);

        if (response.ok && !isPrivateResponse(response)) {
            const clone = response.clone();
            // Do not await the cache write. This prevents large payloads from
            // delaying the response to the user, and isolates the response 
            // from QuotaExceeded errors if the cache fills up.
            event.waitUntil(
                caches.open(cacheName)
                    .then(cache => cache.put(request, clone))
                    .catch(cacheErr => console.warn('[SW] Cache write skipped:', cacheErr))
            );
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) {
            const dateHeader = cached.headers.get('Date');
            if (!dateHeader) {
                // No Date header means we cannot determine the response's age.
                // Serving it risks returning an arbitrarily old payload, so
                // treat it as too stale and let the caller surface an offline error.
                return new Response('Cached response has no Date header — age unknown', { status: 503 });
            }
            // Honour the server's actual max-age directive rather than the
            // hardcoded fallback, so a response with max-age=30 is not
            // served stale minutes later during offline fallback.
            const effectiveMaxAge = parseMaxAge(cached, maxAgeSeconds);
            const ageSeconds = (Date.now() - new Date(dateHeader).getTime()) / 1000;
            if (ageSeconds > effectiveMaxAge) {
                return new Response('Cached response too stale', { status: 503 });
            }
            return cached;
        }
        return new Response('Offline', { status: 503 });
    }
}

// Network-only for HTML: never cache no-store responses.
// Falls back to a minimal offline page if the network is unavailable.
async function networkOnlyWithOfflineFallback(request, cacheName) {
    try {
        return await fetch(request);
    } catch (err) {
        // Try a previously cached version of the app shell as a last resort.
        const cached = await caches.match('/');
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
    }
}