export function sortItems(items, sortBy) {
    const sortedItems = [...items];

    switch (sortBy) {
        case 'date-desc':
            sortedItems.sort((a, b) => new Date(b.date) - new Date(a.date));
            break;
        case 'date-asc':
            sortedItems.sort((a, b) => new Date(a.date) - new Date(b.date));
            break;
        case 'title-asc':
            sortedItems.sort((a, b) => a.title.localeCompare(b.title));
            break;
        case 'title-desc':
            sortedItems.sort((a, b) => b.title.localeCompare(a.title));
            break;
        default:
            sortedItems.sort((a, b) => new Date(b.date) - new Date(a.date));
            break;
    }

    return sortedItems;
}