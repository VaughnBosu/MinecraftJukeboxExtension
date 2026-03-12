// Only mappings that can't be derived by lowercase + space-to-underscore normalization.
const DISC_ID_ALIASES = new Map([
    ['default_1hr', 'the_jukebox'],
    ['default 1hr', 'the_jukebox'],
    ['creator(mb)', 'creator_music_box'],
    ['creator (mb)', 'creator_music_box'],
]);

function toAssetKey(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const lower = raw.toLowerCase();
    if (DISC_ID_ALIASES.has(lower)) return DISC_ID_ALIASES.get(lower);

    let key = lower;
    if (key.startsWith('music_disc.')) {
        key = key.slice('music_disc.'.length);
    }
    key = key.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    return DISC_ID_ALIASES.get(key) || key || null;
}
