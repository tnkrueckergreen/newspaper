import { performSearch as apiSearch } from './api.js';

// Legacy function kept for compatibility if needed, but implementation is empty.
export async function initializeSearch() {
    // No-op: Search is now server-side.
    return; 
}

export async function performSearch(query) {
    // Redirect to API based search
    return await apiSearch(query);
}