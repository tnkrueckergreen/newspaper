import { formatAuthorNamesSummary, formatAuthorNamesFull } from '../../lib/formatters.js';
import { toRootRelativePath } from '../../lib/paths.js';

export function AvatarStack(writers, { size = 'large', compact = false, maxVisible = null } = {}) {
    if (!writers || writers.length === 0) {
        return '';
    }

    const writersWithAvatars = writers;
    let visibleAvatars;
    if (maxVisible !== null) {
        visibleAvatars = writersWithAvatars.slice(0, maxVisible);
    } else if (compact) {
        visibleAvatars = writersWithAvatars.slice(0, 2);
    } else {
        visibleAvatars = writersWithAvatars;
    }
    const avatars = visibleAvatars.map(writer => 
        `<img src="${toRootRelativePath(writer.image)}" alt="${writer.name}" title="${writer.name}">`
    ).join('');
    const remainingCount = writers.length - visibleAvatars.length;

    const moreAvatar = remainingCount > 0 
        ? `<div class="avatar-more">+${remainingCount}</div>` 
        : '';

    return `
        <div class="avatar-stack ${size}">
            ${avatars}
            ${moreAvatar}
        </div>
    `;
}

export function AuthorNames(writers, { fullNames = false } = {}) {
    const formattedNames = fullNames 
        ? formatAuthorNamesFull(writers) 
        : formatAuthorNamesSummary(writers);

    if (!formattedNames) {
        return '';
    }

    return `By ${formattedNames}`;
}

export function Authors(writers, options = {}) {
    if (!writers || writers.length === 0) {
        return '';
    }

    const {
        size = 'large',
        fullNames = false,
        className = 'author-meta'
    } = options;

    const stack = AvatarStack(writers, { size, compact: true });
    const names = AuthorNames(writers, { fullNames });

    const namesSpan = names ? `<span>${names}</span>` : '';

    return `
        <div class="${className} ${size}">
            ${stack}
            ${namesSpan}
        </div>
    `;
}