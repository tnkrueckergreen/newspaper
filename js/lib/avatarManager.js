import { Avatar } from '../components/common/Avatar.js';

/**
 * Finds all avatar elements on the page associated with a user and updates them.
 * @param {object} user - The user object containing user_id, username, and custom_avatar.
 */
export function updateAllAvatars(user) {
    if (!user || !user.user_id) return;

    // Use the immutable user_id to find all avatar elements for this user.
    const avatarElements = document.querySelectorAll(`[data-avatar-user-id="${user.user_id}"]`);

    avatarElements.forEach(element => {
        // Re-generate the avatar HTML using the latest user data and existing size.
        const size = element.dataset.avatarSize || 'medium';
        const newAvatarHTML = Avatar({
            userId: user.user_id,
            username: user.username,
            customAvatar: user.custom_avatar,
            size: size,
        });

        const newElement = document.createRange().createContextualFragment(newAvatarHTML).firstChild;

        if (element.parentNode) {
            element.parentNode.replaceChild(newElement, element);
        }
    });
}