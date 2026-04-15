export function render(template, data = {}) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : '';
    });
}

export function renderList(items, templateFn) {
    return items.map(templateFn).join('');
}

export function renderIf(condition, content) {
    if (!condition) return '';
    return typeof content === 'function' ? content() : content;
}