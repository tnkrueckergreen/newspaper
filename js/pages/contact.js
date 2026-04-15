import { apiFetch } from '../lib/csrf.js';
import { ContactForm } from '../components/forms/ContactForm.js';
import { ContactDetails } from '../components/common/ContactDetails.js';
import { PageHeader } from '../components/layout/PageHeader.js';
import { Container } from '../components/layout/Container.js';
import { Section } from '../components/layout/Section.js';
import {
    showWarning,
    clearWarnings,
    isValidEmail,
    isFieldFilled
} from '../lib/formValidation.js';
import { showError } from '../lib/toast.js';

function createHTML() {
    const formSection = `
        <div class="contact-form-wrapper">
            <h3>Send Us a Message</h3>
            <p>You can use this form if you want to submit your club for club of the month, write an article for the paper, ask us to cover a specific topic, write a letter to the editor, ask a question, or send us any other message.</p>

            <div id="contact-form-container">
                ${ContactForm()}
                <div id="contact-success-message">
                    <div>
                        <h3>Thank You!</h3>
                        <p>Your message has been sent. We'll get back to you shortly.</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    const content = Container(
        PageHeader(
            'Contact Us',
            'Letters to the editor and guest commentaries are encouraged; please email submissions to the following address. Don\'t hesitate to reach out!'
        ) +
        `<div class="contact-grid">
            ${formSection}
            ${ContactDetails()}
        </div>`
    );

    return Section({
        className: 'page contact-page',
        content
    });
}

function attachEventListeners() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    const formContainer = document.getElementById('contact-form-container');
    const submitButton = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        let isValid = true;

        clearWarnings(form);

        const nameInput = document.getElementById('contact-name');
        const emailInput = document.getElementById('contact-email');
        const messageInput = document.getElementById('contact-message');

        if (!isFieldFilled(nameInput.value)) {
            showWarning(nameInput);
            isValid = false;
        }

        if (!isFieldFilled(emailInput.value) || !isValidEmail(emailInput.value)) {
            showWarning(emailInput);
            isValid = false;
        }

        if (!isFieldFilled(messageInput.value)) {
            showWarning(messageInput);
            isValid = false;
        }

        if (isValid) {
            const originalText = submitButton.textContent;
            submitButton.disabled = true;
            submitButton.textContent = 'Sending...';

            const formData = {
                name: nameInput.value,
                email: emailInput.value,
                website: document.getElementById('contact-website').value,
                message: messageInput.value,
            };

            try {
                const response = await apiFetch('/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData),
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || 'Failed to send message.');
                }

                formContainer.classList.add('form-submitted');

            } catch (error) {
                showError(error.message);
                submitButton.disabled = false;
                submitButton.textContent = originalText;
            }
        }
    });
}

export function render(container) {
    // Explicitly allow iframes and necessary attributes for the Google Maps embed
    container.innerHTML = DOMPurify.sanitize(createHTML(), {
        ADD_TAGS: ['iframe'],
        ADD_ATTR: ['allowfullscreen', 'loading', 'referrerpolicy', 'src', 'class', 'title', 'frameborder']
    });
    attachEventListeners();
}