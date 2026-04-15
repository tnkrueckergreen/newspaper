import { subscribe, setEmail, listen as listenToSubscription } from '../lib/subscriptionState.js';

function createHTML() {
    return `
        <section class="page subscribe-page">
            <div class="container">
                <div class="subscribe-content">
                    <h1>Join the ANDOVERVIEW community.</h1>
                    <p>Get the latest stories, features, and updates from our student journalists, sent straight to your inbox.</p>

                    <div id="form-container-page" class="form-container">
                        <form id="subscribe-form-page">
                            <input type="email" id="subscribe-email-page" placeholder="Enter your email address" required>
                            <button type="submit" class="button-subscribe">Subscribe</button>
                        </form>
                        <div id="subscribe-success-message-page" class="subscribe-success">
                            <span>Thank you for subscribing!</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function attachEventListeners() {
    const formContainer = document.getElementById('form-container-page');
    if (!formContainer) return;

    const subscribeForm = document.getElementById('subscribe-form-page');
    const successMessage = document.getElementById('subscribe-success-message-page');
    const emailInput = document.getElementById('subscribe-email-page');
    const submitButton = subscribeForm.querySelector('.button-subscribe');

    listenToSubscription((state) => {
        if (emailInput.value !== state.email) {
            emailInput.value = state.email;
        }
        if (state.isSubscribed) {
            subscribeForm.classList.add('hidden');
            successMessage.classList.add('active');
        }
    });

    emailInput.addEventListener('input', (e) => {
        setEmail(e.target.value);
    });

    subscribeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (emailInput.value && emailInput.checkValidity()) {
            const originalText = submitButton.textContent;
            submitButton.disabled = true;
            submitButton.textContent = 'Subscribing...';

            const success = await subscribe();

            if (!success) {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
            }
        }
    });
}

export function render(container) {
    container.innerHTML = DOMPurify.sanitize(createHTML());
    attachEventListeners();
}