import { login } from '../lib/auth.js';
import { showError, showSuccess } from '../lib/toast.js';
import { initPasswordToggle } from '../lib/passwordToggle.js';
import { navigate } from '../lib/router.js';

function createHTML() {
    return `
        <section class="auth-page">
            <div class="auth-form-container">
                <h1>Log In</h1>
                <p class="subtitle">Don't have an account? <a href="/signup">Sign up</a></p>
                <form id="login-form" class="auth-form">
                    <div class="form-group">
                        <label for="username">Username or Email</label>
                        <input type="text" id="username" name="username" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label for="password">Password</label>
                        <div class="password-input-wrapper">
                            <input type="password" id="password" name="password" required autocomplete="current-password">
                            <button type="button" class="password-toggle-btn" aria-label="Show password">
                                <img src="/assets/icons/eye-slash.svg" alt="Toggle password visibility">
                            </button>
                        </div>
                        <p class="field-hint"><a href="/forgot-password">Forgot your password?</a></p>
                    </div>
                    <button id="login-submit-btn" type="submit">Log In</button>
                </form>
            </div>
        </section>
    `;
}

function attachEventListeners() {
    const form = document.getElementById('login-form');
    const submitBtn = document.getElementById('login-submit-btn');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging In...';

        const username = form.username.value;
        const password = form.password.value;

        const result = await login(username, password);

        if (result.success) {
            showSuccess('Successfully logged in!');
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
            submitBtn.textContent = 'Log In';
        }
    });

    initPasswordToggle(form);
}

export function render(container) {
    container.innerHTML = DOMPurify.sanitize(createHTML());
    attachEventListeners();
}
