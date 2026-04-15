import { showConfetti } from './effects.js';
import { showError } from './toast.js';
import { apiFetch } from './csrf.js';

const state = {
    email: '',
    isSubscribed: false
};

const listeners = new Set();

function notifyListeners() {
    listeners.forEach(listener => listener(state));
}

export function setEmail(newEmail) {
    if (state.isSubscribed) return; // Don't allow changing email after subscribing
    if (state.email !== newEmail) {
        state.email = newEmail;
        notifyListeners();
    }
}

export async function subscribe() {
    if (state.isSubscribed || !state.email) return false;

    try {
        const response = await apiFetch('/api/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: state.email }),
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Subscription failed');
        }

        state.isSubscribed = true;
        notifyListeners();
        showConfetti();
        return true;
    } catch (error) {
        console.error('Subscription failed:', error);
        showError(error.message || 'Could not connect to the server.');
        return false;
    }
}

export function listen(callback) {
    listeners.add(callback);
    callback(state);
}