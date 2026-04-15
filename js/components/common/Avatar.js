import { generateUserGradient } from '../../lib/avatarGenerator.js';
import { toCssUrlPath } from '../../lib/paths.js';

export function Avatar({
    userId,
    username,
    customAvatar = null,
    size = 'medium',
    className = '',
    isAdmin = false
}) {
    if (!username) {
        return '';
    }

    let style, content;
    if (customAvatar) {
        style = `background-image: url('${toCssUrlPath(customAvatar)}'); background-size: cover; background-position: center;`;
        content = '';
    } else {
        style = `background: ${generateUserGradient(username)};`;
        content = username.charAt(0).toUpperCase();
    }

    // Add data attributes for the global updater, using the immutable user_id.
    // Only add if userId exists to support avatars for non-user entities (e.g. staff from text files).
    const dataAttributes = userId 
        ? `data-avatar-user-id="${userId}" data-avatar-size="${size}"`
        : '';

    const classes = `avatar avatar--${size} ${className}`.trim();
    const wrapperClass = `avatar-wrapper${isAdmin ? ' avatar-wrapper--admin' : ''}`;

    return `<div class="${wrapperClass}"><div class="${classes}" style="${style}" ${dataAttributes}>${content}</div></div>`;
}