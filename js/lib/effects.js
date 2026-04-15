export function showConfetti() {
    if (typeof confetti !== 'function') {
        console.warn("Confetti library not loaded.");
        return;
    }

    // AHS school colors! (blue and gold)
    const colors = ['#002D62', '#FFD700'];

    // confetti burst heheheheheeh
    confetti({
        particleCount: 150,
        spread: 120,
        origin: { y: 0.6 },
        colors: colors,
        disableForReducedMotion: true
    });
}