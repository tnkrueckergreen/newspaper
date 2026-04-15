export async function forceDownload(url, filename) {
    // check for touch devices (mobile)
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (isTouchDevice) {
        const newTab = window.open(url, '_blank');
        if (!newTab) {
            alert('Your browser blocked the download, you freaking loser. Please allow pop-ups for this site and try again.');
            throw new Error('Popup blocked by browser');
        }
        return;
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
        console.error('Download failed:', error);
        alert('Could not download the file. Please try again later.');
        throw error;
    }
}