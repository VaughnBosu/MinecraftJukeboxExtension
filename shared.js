(() => {
    const shared = globalThis.MinecraftJukeboxShared || (globalThis.MinecraftJukeboxShared = {});

    const DISC_ID_ALIASES = new Map([
        ['default_1hr', 'the_jukebox'],
        ['default 1hr', 'the_jukebox'],
        ['creator(mb)', 'creator_music_box'],
        ['creator (mb)', 'creator_music_box']
    ]);

    function toAssetKey(value) {
        if (value == null) {
            return null;
        }

        const raw = String(value).trim();
        if (!raw) {
            return null;
        }

        const lower = raw.toLowerCase();
        if (DISC_ID_ALIASES.has(lower)) {
            return DISC_ID_ALIASES.get(lower);
        }

        let key = lower;
        if (key.startsWith('music_disc.')) {
            key = key.slice('music_disc.'.length);
        }

        key = key.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

        return DISC_ID_ALIASES.get(key) || key || null;
    }

    function isRemoteSource(url) {
        return typeof url === 'string' && /^https?:\/\//i.test(url);
    }

    function clampVolume(value, { defaultValue = 1, max = 3 } = {}) {
        if (!Number.isFinite(value)) {
            return defaultValue;
        }

        return Math.min(Math.max(value, 0), max);
    }

    async function blobToBase64(blob) {
        if (!(blob instanceof Blob)) {
            return null;
        }

        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
        return btoa(binaryString);
    }

    function base64ToBlob(base64Data, mimeType = 'audio/ogg') {
        if (typeof base64Data !== 'string' || !base64Data) {
            return null;
        }

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i += 1) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        return new Blob([bytes], { type: mimeType });
    }

    function sanitizeTrack(track) {
        if (!track || typeof track !== 'object') {
            return null;
        }

        const discId = typeof track.discId === 'string' ? track.discId : null;
        if (!discId) {
            return null;
        }

        const providedAssetKey = typeof track.assetKey === 'string' && track.assetKey
            ? track.assetKey
            : null;
        const objectUrl = typeof track.objectUrl === 'string' && track.objectUrl
            ? track.objectUrl.trim()
            : null;

        let assetKey = providedAssetKey || toAssetKey(discId);
        if (!assetKey && objectUrl) {
            assetKey = toAssetKey(discId);
        }

        if (!assetKey) {
            return null;
        }

        const rawFallbacks = Array.isArray(track.streamFallbacks) ? track.streamFallbacks : [];
        const streamFallbacks = [];
        for (const candidate of rawFallbacks) {
            if (typeof candidate !== 'string') {
                continue;
            }

            const trimmed = candidate.trim();
            if (!trimmed || trimmed === objectUrl || !isRemoteSource(trimmed)) {
                continue;
            }

            if (!streamFallbacks.includes(trimmed)) {
                streamFallbacks.push(trimmed);
            }
        }

        const isStream = Boolean(track.isStream) || isRemoteSource(objectUrl);
        const sanitized = {
            discId,
            assetKey
        };

        if (objectUrl) {
            sanitized.objectUrl = objectUrl;
        }
        if (streamFallbacks.length) {
            sanitized.streamFallbacks = streamFallbacks;
        }
        if (isStream) {
            sanitized.isStream = true;
        }

        return sanitized;
    }

    function sanitizeTrackList(list) {
        if (!Array.isArray(list)) {
            return [];
        }

        return list.map(sanitizeTrack).filter(Boolean);
    }

    function createPersistedTrack(track) {
        const sanitized = sanitizeTrack(track);
        if (!sanitized) {
            return null;
        }

        const persisted = {
            discId: sanitized.discId,
            assetKey: sanitized.assetKey
        };

        if (sanitized.objectUrl) {
            persisted.objectUrl = sanitized.objectUrl;
        }
        if (Array.isArray(sanitized.streamFallbacks) && sanitized.streamFallbacks.length) {
            persisted.streamFallbacks = sanitized.streamFallbacks.slice();
        }
        if (sanitized.isStream) {
            persisted.isStream = true;
        }

        return persisted;
    }

    Object.assign(shared, {
        DISC_ID_ALIASES,
        toAssetKey,
        isRemoteSource,
        clampVolume,
        blobToBase64,
        base64ToBlob,
        sanitizeTrack,
        sanitizeTrackList,
        createPersistedTrack
    });

    globalThis.DISC_ID_ALIASES = DISC_ID_ALIASES;
    globalThis.toAssetKey = toAssetKey;
})();
