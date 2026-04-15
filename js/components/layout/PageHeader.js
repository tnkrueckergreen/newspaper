export function PageHeader(title, subtitle = '') {
    return `
        <div class="page-header">
            <h1>${title}</h1>
            ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
    `;
}