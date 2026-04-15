export function showWarning(inputElement, message) {
    const warning = document.querySelector(`[data-warning-for="${inputElement.id}"]`);
    if (warning) {
        warning.textContent = message || warning.dataset.defaultMessage;
        warning.style.display = 'block';
    }
    inputElement.classList.add('invalid');
}

export function clearWarnings(form) {
    form.querySelectorAll('.warning-message').forEach(el => el.style.display = 'none');
    form.querySelectorAll('input, textarea').forEach(el => el.classList.remove('invalid'));
}

export function isValidEmail(email) {
    return /^\S+@\S+\.\S+$/.test(email);
}

export function isFieldFilled(value) {
    return value.trim().length > 0;
}