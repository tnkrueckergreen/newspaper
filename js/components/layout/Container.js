export function Container(content, className = '') {
    return `
        <div class="container ${className}">
            ${content}
        </div>
    `;
}