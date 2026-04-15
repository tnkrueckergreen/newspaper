
export function showToast(message, type = 'info', duration = 3000) {
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

export function showSuccess(message, duration = 3000) {
    showToast(message, 'success', duration);
}

export function showError(message, duration = 4000) {
    showToast(message, 'error', duration);
}

export function showWarning(message, duration = 3500) {
    showToast(message, 'warning', duration);
}
