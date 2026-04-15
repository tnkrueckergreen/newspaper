export function SocialShare(article, options = {}) {
    const { variant = 'full' } = options;

    const currentUrl = encodeURIComponent(window.location.href);
    const title = encodeURIComponent(article.title);
    const description = encodeURIComponent(article.description);

    const shareLinks = [
        { name: 'Email', icon: 'email.svg', url: `mailto:?subject=${title}&body=${description}%0A%0A${currentUrl}` },
        { name: 'Facebook', icon: 'facebook.svg', url: `https://www.facebook.com/sharer/sharer.php?u=${currentUrl}` },
        { name: 'X (Twitter)', icon: 'twitter.svg', url: `https://twitter.com/intent/tweet?url=${currentUrl}&text=${title}` },
        { name: 'LinkedIn', icon: 'linkedin.svg', url: `https://www.linkedin.com/sharing/share-offsite/?url=${currentUrl}` },
        { name: 'Reddit', icon: 'reddit.svg', url: `https://reddit.com/submit?url=${currentUrl}&title=${title}` },
        { name: 'WhatsApp', icon: 'whatsapp.svg', url: `https://wa.me/?text=${title}%20${currentUrl}` }
    ];

    if (variant === 'minimal') {
        const minimalButtons = shareLinks.slice(0, 5).map(link => `
            <a href="${link.url}"
               target="_blank"
               rel="noopener noreferrer"
               class="social-share-button-minimal"
               title="Share on ${link.name}"
               aria-label="Share on ${link.name}">
                <img src="/assets/icons/${link.icon}" alt="${link.name}" class="social-share-icon-minimal" aria-hidden="true">
            </a>
        `).join('');

        const copyLinkButton = `
            <button class="social-share-button-minimal copy-link-btn" title="Copy link" aria-label="Copy article link">
                <span class="copy-link-icon-wrapper">
                    <img src="/assets/icons/link.svg" alt="Copy link" class="social-share-icon-minimal" aria-hidden="true">
                </span>
                <span class="copy-link-success-message">Copied!</span>
            </button>
        `;

        return `<div class="social-share-minimal">${copyLinkButton}${minimalButtons}</div>`;

    } else {
        const allShareLinks = [ ...shareLinks,
            { name: 'Telegram', icon: 'telegram.svg', url: `https://t.me/share/url?url=${currentUrl}&text=${title}` },
            { name: 'Bluesky', icon: 'bluesky.svg', url: `https://bsky.app/intent/compose?text=${title}%20${currentUrl}` }
        ];

        const fullButtons = allShareLinks.map(link => `
            <a href="${link.url}"
               target="_blank"
               rel="noopener noreferrer"
               class="social-share-button"
               aria-label="Share on ${link.name}">
                <img src="/assets/icons/${link.icon}" alt="" class="social-share-icon" aria-hidden="true">
                <span>${link.name}</span>
            </a>
        `).join('');

        return `
            <div class="social-share-container">
                <h4 class="social-share-title">Share this Article</h4>
                <div class="social-share-buttons">
                    ${fullButtons}
                </div>
            </div>
        `;
    }
}