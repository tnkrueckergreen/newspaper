export function toRootRelativePath(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const path = value.trim();
    if (!path) return fallback;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) return path;
    if (path.startsWith('/')) return path;
    return `/${path.replace(/^\.\//, '')}`;
}

export function toCssUrlPath(value, fallback = '') {
    return toRootRelativePath(value, fallback).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}