import { toRootRelativePath } from './paths.js';

export function initPasswordToggle(container) {
    const toggleButtons = container.querySelectorAll('.password-toggle-btn');

    toggleButtons.forEach(button => {
        button.addEventListener('click', () => {
            const input = button.previousElementSibling;
            const icon = button.querySelector('img');

            if (input.type === 'password') {
                input.type = 'text';
                icon.src = toRootRelativePath('assets/icons/eye.svg');
                button.setAttribute('aria-label', 'Hide password');
            } else {
                input.type = 'password';
                icon.src = toRootRelativePath('assets/icons/eye-slash.svg');
                button.setAttribute('aria-label', 'Show password');
            }
        });
    });
}