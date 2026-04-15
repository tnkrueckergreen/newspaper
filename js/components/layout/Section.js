export function Section(options) {
    const {
        id = '',
        className = 'page',
        content = ''
    } = options;

    return `
        <section ${id ? `id="${id}"` : ''} class="${className}">
            ${content}
        </section>
    `;
}