const crypto = require('crypto');

const CSRF_COOKIE = 'XSRF-TOKEN';
const CSRF_HEADER = 'x-csrf-token';

function parseCookies(cookieHeader = '') {
    const cookies = {};
    cookieHeader.split(';').forEach(part => {
        const [name, ...rest] = part.trim().split('=');
        if (name) cookies[name.trim()] = decodeURIComponent(rest.join('='));
    });
    return cookies;
}

function csrfMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies[CSRF_COOKIE]) {
        const token = crypto.randomBytes(32).toString('hex');
        res.cookie(CSRF_COOKIE, token, {
            httpOnly: false,
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });
    }
    next();
}

function csrfProtection(req, res, next) {
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method.toUpperCase())) return next();

    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: 'Invalid CSRF token. Please refresh the page and try again.' });
    }
    next();
}

module.exports = { csrfMiddleware, csrfProtection };
