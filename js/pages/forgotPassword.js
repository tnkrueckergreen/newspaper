import { showError } from '../lib/toast.js';
import { apiFetch } from '../lib/csrf.js';

function createHTML() {
    return `
        <section class="auth-page">
            <div class="auth-form-container">
                <h1>Forgot Password</h1>

                <div id="forgot-form-wrap">
                    <p class="subtitle">Enter your email address and we'll send you a link to reset your password.</p>
                    <form id="forgot-password-form" class="auth-form">
                        <div class="form-group">
                            <label for="email">Email Address</label>
                            <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@example.com">
                        </div>
                        <button id="forgot-submit-btn" type="submit">Send Reset Link</button>
                    </form>
                </div>

                <div id="forgot-success" class="auth-success-message" style="display:none; padding-bottom: 0;">
                    <p style="margin-bottom: 0;">If an account with that email exists, a password reset link has been sent. Check your inbox.</p>
                </div>

                <p class="subtitle" style="margin-top: 1.5rem; margin-bottom: 0;">
                    <a href="/login">&larr; Back to Log In</a>
                </p>
            </div>
        </section>
    `;
}

function attachEventListeners() {
    const form = document.getElementById('forgot-password-form');
    const submitBtn = document.getElementById('forgot-submit-btn');
    const successDiv = document.getElementById('forgot-success');
    const formWrap = document.getElementById('forgot-form-wrap');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = form.email.value.trim();

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
            const response = await apiFetch('/api/users/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await response.json();

            if (response.ok) {
                if (formWrap) formWrap.style.display = 'none';
                successDiv.style.display = 'block';
            } else {
                showError(data.error || 'Something went wrong. Please try again.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Reset Link';
            }
        } catch {
            showError('Could not connect to the server.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Reset Link';
        }
    });
}

export function render(container) {
    container.innerHTML = DOMPurify.sanitize(createHTML());
    attachEventListeners();
}