import { invalidateCache } from './api.js';
import { updateAuthUI } from '../ui/authUI.js';
import { apiFetch } from './csrf.js';

const AUTH_STORAGE_KEY = 'ahsv2_auth_user';

// 1. SYNCHRONOUS INITIALIZATION
// Load from storage immediately so state is ready before any async code runs
let currentUser = null;
let isLoggedIn = false;

try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
        currentUser = JSON.parse(stored);
        isLoggedIn = true;
    }
} catch (e) {
    console.warn('Auth storage access failed', e);
}

let authChecked = false;
let authPromise = null;

function triggerUIUpdate() {
    updateAuthUI(isLoggedIn, currentUser);
    document.dispatchEvent(new CustomEvent('auth:status-changed', { 
        detail: { isLoggedIn, currentUser } 
    }));
}

function saveAuthToStorage(user) {
    try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    } catch (e) { /* ignore */ }
}

function clearAuthFromStorage() {
    try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (e) { /* ignore */ }
}

export function updateCurrentUser(newUser) {
    if (isLoggedIn && newUser) {
        currentUser = newUser;
        saveAuthToStorage(currentUser); // Persist updates (e.g. avatar change)
        invalidateCache();
        triggerUIUpdate();
    }
}

export async function login(username, password) {
    try {
        const response = await apiFetch('/api/users/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
        if (response.ok) {
            isLoggedIn = true;
            currentUser = data;
            saveAuthToStorage(currentUser); // Save session
            invalidateCache();
            triggerUIUpdate();
            return { success: true, currentPath: location.pathname };
        } else {
            return { success: false, error: data.error };
        }
    } catch (error) {
        return { success: false, error: 'Could not connect to the server.' };
    }
}

export async function signup(username, password, email) {
    try {
        const response = await apiFetch('/api/users/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, email }),
        });
        const data = await response.json();
        if (response.ok) {
            isLoggedIn = true;
            currentUser = data;
            saveAuthToStorage(currentUser);
            invalidateCache();
            triggerUIUpdate();
            return { success: true, currentPath: location.pathname };
        } else {
            return { success: false, error: data.error };
        }
    } catch (error) {
        return { success: false, error: 'Could not connect to the server.' };
    }
}

// Internal worker
async function performAuthCheck() {
    try {
        const response = await fetch('/api/users/status');
        const data = await response.json();

        if (data.loggedIn) {
            // Server confirms we are logged in
            isLoggedIn = true;
            currentUser = data.user;
            saveAuthToStorage(currentUser); // Sync fresh data from server
        } else {
            // Server says session expired
            if (isLoggedIn) {
                // If we thought we were logged in, handle logout
                isLoggedIn = false;
                currentUser = null;
                clearAuthFromStorage();
                invalidateCache(); // Drop cached authenticated data (likes, bookmarks)
            }
        }
    } catch (error) {
        console.error('Error checking login status:', error);
        // On network error, keep existing optimistic state (offline mode support)
    } finally {
        authChecked = true;
        triggerUIUpdate();
    }
}

// Public function
export function checkLoginStatus() {
    // Return immediately if already checked
    if (authChecked) return Promise.resolve();
    if (authPromise) return authPromise;

    authPromise = performAuthCheck();
    return authPromise;
}

export async function waitForAuth() {
    if (authChecked) return;
    await checkLoginStatus();
}

export async function handleLogout() {
    try {
        await apiFetch('/api/users/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout failed:', error);
    } finally {
        // Always clean up client side
        isLoggedIn = false;
        currentUser = null;
        clearAuthFromStorage();
        invalidateCache();
        triggerUIUpdate();
        // Replace current history entry with the base path so the reload lands
        // on the home page without first firing a hashchange event (which would
        // cause the router to do a spurious render before the page reloads).
        location.replace(location.pathname);
    }
}

export function getCurrentUser() { return currentUser; }
export function getIsLoggedIn() { return isLoggedIn; }