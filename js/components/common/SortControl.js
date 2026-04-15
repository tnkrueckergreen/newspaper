export function SortControl() {
    return `
        <div class="sort-container">
            <label for="sort-by">Sort by:</label>
            <select name="sort-by" id="sort-by">
                <option value="date-desc">Newest</option>
                <option value="date-asc">Oldest</option>
                <option value="title-asc">Title (A-Z)</option>
                <option value="title-desc">Title (Z-A)</option>
            </select>
        </div>
    `;
}