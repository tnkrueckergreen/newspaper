import { signup } from '../lib/auth.js';
import { showError, showSuccess } from '../lib/toast.js';
import { initPasswordToggle } from '../lib/passwordToggle.js';
import { navigate } from '../lib/router.js';

function createHTML() {
    return `
        <section class="auth-page">
            <div class="auth-form-container">
                <h1>Create Account</h1>
                <p class="subtitle">Already have an account? <a href="/login">Log in</a></p>
                <form id="signup-form" class="auth-form">
                    <div class="form-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" name="username" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label for="email">Email Address</label>
                        <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@example.com">
                    </div>
                    <div class="form-group">
                        <label for="password">Password (min. 6 characters)</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="password" name="password" required minlength="6" autocomplete="new-password">
                            <button type="button" class="password-toggle-btn" aria-label="Show password">
                                <img src="/assets/icons/eye-slash.svg" alt="Toggle password visibility">
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="confirm-password">Confirm Password</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="confirm-password" name="confirm-password" required minlength="6" autocomplete="new-password">
                            <button type="button" class="password-toggle-btn" aria-label="Show password">
                                <img src="/assets/icons/eye-slash.svg" alt="Toggle password visibility">
                            </button>
                        </div>
                    </div>
                    <button id="signup-submit-btn" type="submit">Sign Up</button>
                </form>
            </div>
        </section>
    `;
}

function attachEventListeners() {
    const form = document.getElementById('signup-form');
    const submitBtn = document.getElementById('signup-submit-btn');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing Up...';

        const username = form.username.value;
        const email = form.email.value.trim();
        const password = form.password.value;
        const confirmPassword = form['confirm-password'].value;

        if (password !== confirmPassword) {
            showError('Passwords do not match.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign Up';
            return;
        }

        const result = await signup(username, password, email);

        if (result.success) {
            showSuccess('Account created successfully!');
            const returnTo = sessionStorage.getItem('returnToAfterAuth') || location.pathname || '/';
            const scrollPosition = sessionStorage.getItem('scrollPositionBeforeAuth');
            sessionStorage.removeItem('returnToAfterAuth');
            sessionStorage.removeItem('scrollPositionBeforeAuth');

            navigate(returnTo);

            if (scrollPosition) {
                setTimeout(() => {
                    window.scrollTo(0, parseInt(scrollPosition));
                }, 100);
            }
        } else {
            showError(result.error || 'An unknown error occurred.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign Up';
        }
    });

    initPasswordToggle(form);
}

export function render(container) {
    container.innerHTML = DOMPurify.sanitize(createHTML());
    attachEventListeners();
}
