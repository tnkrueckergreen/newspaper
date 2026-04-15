export function ContactForm() {
    return `
        <form id="contact-form" novalidate>
            ${FormField({
                id: 'contact-name',
                label: 'Name (required)',
                type: 'text',
                required: true,
                warningMessage: 'Please enter your name.'
            })}
            ${FormField({
                id: 'contact-email',
                label: 'Email (required)',
                type: 'email',
                required: true,
                warningMessage: 'Please enter a valid email address.'
            })}
            ${FormField({
                id: 'contact-website',
                label: 'Website',
                type: 'url',
                placeholder: 'https://example.com',
                warningMessage: 'Please enter a valid URL.'
            })}
            ${FormField({
                id: 'contact-message',
                label: 'Message (required)',
                type: 'textarea',
                rows: 5,
                required: true,
                warningMessage: 'Please enter your message.'
            })}
            <button type="submit" class="button-primary">Send Message</button>
        </form>
    `;
}

function FormField(options) {
    const {
        id,
        label,
        type = 'text',
        required = false,
        placeholder = '',
        rows,
        warningMessage
    } = options;

    const isTextarea = type === 'textarea';

    const input = isTextarea
        ? `<textarea id="${id}" name="${id.replace('contact-', '')}" rows="${rows}" ${required ? 'required' : ''}></textarea>`
        : `<input type="${type}" id="${id}" name="${id.replace('contact-', '')}" ${required ? 'required' : ''} ${placeholder ? `placeholder="${placeholder}"` : ''}>`;

    return `
        <div class="form-group">
            <label for="${id}">${label}</label>
            ${input}
            <span class="warning-message" data-warning-for="${id}">${warningMessage}</span>
        </div>
    `;
}