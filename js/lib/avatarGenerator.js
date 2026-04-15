// fancy code for generating some STUNNING gradient avatars

function djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) + hash) + char;
    }
    return hash;
}

export function generateUserGradient(username) {
    if (!username) {
        return 'linear-gradient(45deg, #888, #666)';
    }

    const hash = djb2Hash(username);
    const baseHue = Math.abs(hash) % 360;
    const saturation = 55 + (Math.abs(Math.floor(hash / 10000)) % 26);
    const lightness = 45 + (Math.abs(Math.floor(hash / 100000)) % 11);
    const angle = Math.abs(Math.floor(hash / 1000)) % 360;
    const useThreeColors = Math.abs(hash) % 2 === 1;

    const color1 = `hsl(${baseHue}, ${saturation}%, ${lightness}%)`;

    if (useThreeColors) {
        const triadOffset = (Math.abs(Math.floor(hash / 360)) % 31) - 15;
        const hue2 = (baseHue + 120 + triadOffset) % 360;
        const hue3 = (baseHue + 240 + triadOffset) % 360;

        const color2 = `hsl(${hue2}, ${saturation}%, ${lightness}%)`;
        const color3 = `hsl(${hue3}, ${saturation}%, ${lightness}%)`;

        return `linear-gradient(${angle}deg, ${color1} 0%, ${color2} 50%, ${color3} 100%)`;

    } else {
        const analogousOffset = 40 + (Math.abs(Math.floor(hash / 360)) % 31);
        const hue2 = (baseHue + analogousOffset) % 360;

        const color2 = `hsl(${hue2}, ${saturation}%, ${lightness}%)`;

        return `linear-gradient(${angle}deg, ${color1}, ${color2})`;
    }
}