(() => {
    const shared = globalThis.MinecraftJukeboxShared || (globalThis.MinecraftJukeboxShared = {});

    const BLOB_DB_NAME = 'minecraftJukeboxAssets';
    const BLOB_DB_VERSION = 1;
    const BLOB_STORE_NAME = 'discBlobs';

    function toAssetKey(value) {
        if (value == null) {
            return null;
        }

        const key = String(value)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');

        return key || null;
    }

    function isRemoteSource(url) {
        return typeof url === 'string' && /^https?:\/\//i.test(url);
    }

    function clampVolume(value) {
        return Number.isFinite(value) ? Math.min(Math.max(value, 0), 3) : 1;
    }

    function sendMessageSafe(payload) {
        return chrome.runtime.sendMessage(payload).catch(() => {});
    }

    async function blobToBase64(blob) {
        if (!(blob instanceof Blob)) {
            return null;
        }

        const bytes = new Uint8Array(await blob.arrayBuffer());
        return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
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

    function openBlobDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(BLOB_DB_NAME, BLOB_DB_VERSION);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
                    db.createObjectStore(BLOB_STORE_NAME, { keyPath: 'key' });
                }
            };
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function readBlobFromCache(key) {
        const db = await openBlobDb();
        try {
            return await new Promise((resolve, reject) => {
                const request = db.transaction(BLOB_STORE_NAME, 'readonly')
                    .objectStore(BLOB_STORE_NAME)
                    .get(key);
                request.onsuccess = () => {
                    const { blob } = request.result || {};
                    resolve(blob instanceof Blob ? blob : null);
                };
                request.onerror = () => reject(request.error);
            });
        } finally {
            db.close();
        }
    }

    function sanitizeTrack(track) {
        if (!track || typeof track !== 'object') {
            return null;
        }

        const discId = typeof track.discId === 'string' ? track.discId : null;
        if (!discId) {
            return null;
        }

        const objectUrl = typeof track.objectUrl === 'string' && track.objectUrl
            ? track.objectUrl.trim()
            : null;
        const assetKey = (typeof track.assetKey === 'string' && track.assetKey)
            ? track.assetKey
            : toAssetKey(discId);
        if (!assetKey) {
            return null;
        }

        const streamFallbacks = [];
        for (const candidate of Array.isArray(track.streamFallbacks) ? track.streamFallbacks : []) {
            if (typeof candidate !== 'string') {
                continue;
            }

            const trimmed = candidate.trim();
            if (trimmed && trimmed !== objectUrl && isRemoteSource(trimmed) && !streamFallbacks.includes(trimmed)) {
                streamFallbacks.push(trimmed);
            }
        }

        const sanitized = { discId, assetKey };
        if (objectUrl) {
            sanitized.objectUrl = objectUrl;
        }
        if (streamFallbacks.length) {
            sanitized.streamFallbacks = streamFallbacks;
        }
        if (Boolean(track.isStream) || isRemoteSource(objectUrl)) {
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

    Object.assign(shared, {
        BLOB_STORE_NAME,
        toAssetKey,
        isRemoteSource,
        clampVolume,
        sendMessageSafe,
        blobToBase64,
        base64ToBlob,
        openBlobDb,
        readBlobFromCache,
        sanitizeTrack,
        sanitizeTrackList
    });
})();
