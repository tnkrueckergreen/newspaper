import { Avatar } from '../components/common/Avatar.js';
import { updateAllAvatars } from '../lib/avatarManager.js';

export function updateAuthUI(isLoggedIn, currentUser) {
    const authStatusContainer = document.getElementById('auth-status');
    const authBtnMobileContainer = document.getElementById('auth-btn-mobile');
    const isAdmin = isLoggedIn && currentUser && currentUser.is_admin;
    const accountHref = isAdmin ? '/account?tab=admin' : '/account';
    const accountLabel = isAdmin ? 'Admin' : 'My Account';
    const accountTitle = isAdmin ? 'Admin Panel' : 'My Account';

    document.body.classList.toggle('user-is-logged-in', isLoggedIn);
    document.body.classList.toggle('user-is-admin', !!isAdmin);

    if (authStatusContainer) {
        if (isLoggedIn && currentUser) {
            authStatusContainer.innerHTML = '';

            if (isAdmin) {
                const newArticleLink = document.createElement('a');
                newArticleLink.href = '/admin/create';
                newArticleLink.className = 'button-admin-new';
                newArticleLink.setAttribute('title', 'Create new article');
                newArticleLink.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Article`;
                authStatusContainer.appendChild(newArticleLink);
            }

            const myAccountLink = document.createElement('a');
            myAccountLink.href = accountHref;
            myAccountLink.className = 'button-secondary';
            myAccountLink.textContent = accountLabel;
            myAccountLink.title = accountTitle;

            const avatarLink = document.createElement('a');
            avatarLink.href = accountHref;
            avatarLink.title = accountTitle;
            avatarLink.className = 'header-avatar-link';

            const avatarHTML = Avatar({
                userId: currentUser.user_id,
                username: currentUser.username,
                customAvatar: currentUser.custom_avatar,
                size: 'small',
                className: 'header-avatar',
                isAdmin: currentUser.is_admin || false
            });
            avatarLink.innerHTML = DOMPurify.sanitize(avatarHTML);

            authStatusContainer.appendChild(myAccountLink);
            authStatusContainer.appendChild(avatarLink);
        }
    }

    if (authBtnMobileContainer) {
        if (isLoggedIn && currentUser) {
            authBtnMobileContainer.innerHTML = '';
            if (isAdmin) {
                const newArticleMobileLink = document.createElement('a');
                newArticleMobileLink.href = '/admin/create';
                newArticleMobileLink.className = 'button-admin-new';
                newArticleMobileLink.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Article`;
                authBtnMobileContainer.appendChild(newArticleMobileLink);
            }
            const myAccountLink = document.createElement('a');
            myAccountLink.href = accountHref;
            myAccountLink.className = 'button-secondary';
            myAccountLink.textContent = accountLabel;
            myAccountLink.title = accountTitle;
            authBtnMobileContainer.appendChild(myAccountLink);
        } else {
            authBtnMobileContainer.innerHTML = '<a href="/login" class="button-secondary">Log In</a>';
        }
    }

    if (currentUser) {
        updateAllAvatars(currentUser);
    }
}
