import { showError, showSuccess } from '../lib/toast.js';
import { apiFetch } from '../lib/csrf.js';
import { initPasswordToggle } from '../lib/passwordToggle.js';
import { navigate } from '../lib/router.js';

function createHTML(token) {
    if (!token) {
        return `
            <section class="auth-page">
                <div class="auth-form-container">
                    <h1>Invalid Link</h1>
                    <p class="subtitle">This password reset link is missing or invalid. Please request a new one.</p>
                    <p class="subtitle"><a href="/forgot-password">Request a new link</a></p>
                </div>
            </section>
        `;
    }

    return `
        <section class="auth-page">
            <div class="auth-form-container">
                <h1>Reset Password</h1>
                <p class="subtitle">Choose a new password for your account.</p>
                <form id="reset-password-form" class="auth-form">
                    <div class="form-group">
                        <label for="new-password">New Password (min. 6 characters)</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="new-password" name="new-password" required minlength="6" autocomplete="new-password">
                            <button type="button" class="password-toggle-btn" aria-label="Show password">
                                <img src="/assets/icons/eye-slash.svg" alt="Toggle password visibility">
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="confirm-password">Confirm New Password</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="confirm-password" name="confirm-password" required minlength="6" autocomplete="new-password">
                            <button type="button" class="password-toggle-btn" aria-label="Show password">
                                <img src="/assets/icons/eye-slash.svg" alt="Toggle password visibility">
                            </button>
                        </div>
                    </div>
                    <button id="reset-submit-btn" type="submit">Reset Password</button>
                </form>
            </div>
        </section>
    `;
}

function attachEventListeners(token) {
    if (!token) return;

    const form = document.getElementById('reset-password-form');
    const submitBtn = document.getElementById('reset-submit-btn');
    if (!form) return;

    initPasswordToggle(form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        if (newPassword !== confirmPassword) {
            showError('Passwords do not match.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Resetting...';

        try {
            const response = await apiFetch('/api/users/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword }),
            });
            const data = await response.json();

            if (response.ok) {
                showSuccess('Password reset successfully! Please log in with your new password.');
                setTimeout(() => { navigate('/login'); }, 1500);
            } else {
                showError(data.error || 'Something went wrong. Please try again.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Reset Password';
            }
        } catch {
            showError('Could not connect to the server.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Reset Password';
        }
    });
}

export function render(container, token) {
    container.innerHTML = DOMPurify.sanitize(createHTML(token));
    attachEventListeners(token);
}
