// config.js
const CONFIG = {

    // ── Owner Contact ─────────────────────────────────────────
    TELEGRAM_USERNAME : 'kaaoffc_',   // tanpa @ — isi username Telegram owner

    // ── Proxy (kosongkan jika pakai server.js di port sama) ──
    // Isi jika deploy ke VPS dengan URL berbeda:
    // PROXY_URL : 'https://namaserver.vercel.app',
    PROXY_URL : 'https://motion-prems.vercel.app',

    // ── Music Player ─────────────────────────────────────────
    MUSIC_VIDEO  : '',           // Link mp4 (video background player)
    MUSIC_AUDIO  : '',           // Link mp3 (audio yang diputar)
    MUSIC_TITLE  : '18 - One Direction',
    MUSIC_ARTIST : 'One Direction',
    MUSIC_TAG    : 'KaaOffc · All Downloader',

};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
