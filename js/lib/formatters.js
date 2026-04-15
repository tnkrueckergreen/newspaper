export function formatAuthorNamesSummary(writers) {
    const names = writers.map(w => w.name);
    const count = names.length;

    if (count === 0) return '';
    if (count === 1) return names[0];
    if (count === 2) return `${names[0]} and ${names[1]}`;
    
    const remainingCount = count - 2;
    return `${names[0]}, ${names[1]}, and ${remainingCount} more`;
}

export function formatAuthorNamesFull(writers) {
    const names = writers.map(w => w.name);
    const count = names.length;

    if (count === 0) return '';
    if (count === 1) return names[0];
    if (count === 2) return `${names[0]} and ${names[1]}`;

    const allButLast = names.slice(0, -1).join(', ');
    const last = names.slice(-1);
    return `${allButLast}, and ${last}`;
}