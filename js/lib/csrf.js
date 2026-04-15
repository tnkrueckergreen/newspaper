function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
}

export function apiFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        options = {
            ...options,
            headers: {
                'X-CSRF-Token': getCsrfToken(),
                ...options.headers,
            }
        };
    }
    return fetch(url, options);
}
