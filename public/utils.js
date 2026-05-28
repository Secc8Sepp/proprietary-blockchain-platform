// ==========================================
// GLOBAL UTILITIES & UI HELPERS
// ==========================================

function resolveProfile(address) {
    return networkProfiles[address] || { username: `Node_${address.substring(0,6)}`, avatarHash: '' };
}

function getAvatarUrl(address) {
    const p = resolveProfile(address);
    return p.avatarHash ? `/tracks/${p.avatarHash}` : `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(address)}&backgroundColor=1f2833`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeJsArg(str) {
    if(!str) return '';
    return str.toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function parseMentions(text) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    return escaped.replace(/@([a-zA-Z0-9_]+)/g, (match, p1) => {
        return `<span class="mention" onclick="inspectTargetNode('${p1}')">${match}</span>`;
    });
}

function renderBadges(roles) {
    if (!roles || !roles.length) return '';
    const badgeMap = { 'admin': '🛠️ Admin', 'artist': '🎵 Artist', 'whale': '🐋 Whale' };
    return roles.map(r => `<span class="user-badge" title="${r}">${badgeMap[r] || '✨'}</span>`).join('');
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

function isNodeBlocked(publicKey) {
    if (!publicKey) return false;
    let blocks = JSON.parse(localStorage.getItem('vod_blocked_nodes') || '[]');
    return blocks.includes(publicKey);
}