(() => {
    const bg = globalThis.MinecraftJukeboxBackground;
    const shared = globalThis.MinecraftJukeboxShared;
    const { toAssetKey, blobToBase64, base64ToBlob } = shared;

    const DISC_INDEX_STORAGE_KEY = 'minecraftDiscIndex';
    const BLOB_DB_NAME = 'minecraftJukeboxAssets';
    const BLOB_DB_VERSION = 1;
    const BLOB_STORE_NAME = 'discBlobs';

    bg.messageTypesExpectingResponse = new Set([
        'minecraftAssetsUploadedIndex',
        'minecraftAssetBlob',
        'minecraftAssetsUploadComplete',
        'requestMinecraftAssets',
        'requestDiscBlob',
        'requestState'
    ]);

    bg.minecraftAssetState = {
        rootDirectory: null,
        objectsDirectory: null,
        discIndex: new Map(),
        latestIndexName: null
    };

    bg.blobAssetLibrary = new Map();
    bg.expectedBlobKeys = new Set();
    bg.blobLibraryReadyResolve = null;

    let blobDbPromise = null;

    bg.getBlobDb = function getBlobDb() {
        if (blobDbPromise) {
            return blobDbPromise;
        }

        blobDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(BLOB_DB_NAME, BLOB_DB_VERSION);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
                    db.createObjectStore(BLOB_STORE_NAME, { keyPath: 'key' });
                }
            };
            request.onsuccess = event => {
                const db = event.target.result;
                db.onclose = () => {
                    blobDbPromise = null;
                };
                resolve(db);
            };
            request.onerror = () => {
                reject(request.error);
            };
        }).catch(error => {
            console.warn('Failed to open blob database', error);
            throw error;
        });

        return blobDbPromise;
    };

    bg.storeBlobEntries = async function storeBlobEntries(entries = []) {
        try {
            const db = await bg.getBlobDb();
            const transaction = db.transaction(BLOB_STORE_NAME, 'readwrite');
            const store = transaction.objectStore(BLOB_STORE_NAME);
            await new Promise((resolve, reject) => {
                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(transaction.error);
                store.clear().onsuccess = () => {
                    for (const [key, blob] of entries) {
                        if (typeof key !== 'string' || !(blob instanceof Blob)) {
                            continue;
                        }
                        store.put({ key, blob });
                    }
                };
            });
        } catch (error) {
            console.warn('[MinecraftJukebox] Failed to persist blob assets', error);
        }
    };

    bg.loadBlobEntries = async function loadBlobEntries() {
        try {
            const db = await bg.getBlobDb();
            const transaction = db.transaction(BLOB_STORE_NAME, 'readonly');
            const store = transaction.objectStore(BLOB_STORE_NAME);
            return await new Promise((resolve, reject) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Failed to load blob assets', error);
            return [];
        }
    };

    bg.hydrateBlobLibraryFromDb = async function hydrateBlobLibraryFromDb() {
        const records = await bg.loadBlobEntries();
        bg.blobAssetLibrary.clear();

        for (const record of records) {
            if (!record || typeof record.key !== 'string' || !(record.blob instanceof Blob)) {
                continue;
            }

            bg.blobAssetLibrary.set(record.key, {
                blob: record.blob,
                objectUrl: null
            });
        }
    };

    bg.storeSingleBlobEntry = async function storeSingleBlobEntry(key, blob) {
        try {
            const db = await bg.getBlobDb();
            const transaction = db.transaction(BLOB_STORE_NAME, 'readwrite');
            const store = transaction.objectStore(BLOB_STORE_NAME);
            const putRequest = store.put({ key, blob });

            await new Promise((resolve, reject) => {
                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(transaction.error);
                putRequest.onerror = () => reject(putRequest.error);
            });
        } catch (error) {
            console.error('[MinecraftJukebox] Failed to persist blob asset for key:', key, error);
            throw error;
        }
    };

    bg.broadcastDiscCacheCleared = function broadcastDiscCacheCleared() {
        const maybePromise = chrome.runtime.sendMessage({ type: 'minecraftDiscCacheCleared' });
        if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => {});
        }
    };

    bg.clearStoredDiscLibrary = async function clearStoredDiscLibrary() {
        try {
            const db = await bg.getBlobDb();
            const transaction = db.transaction(BLOB_STORE_NAME, 'readwrite');
            const store = transaction.objectStore(BLOB_STORE_NAME);
            store.clear();
            await new Promise(resolve => {
                transaction.oncomplete = resolve;
                transaction.onerror = resolve;
            });
        } catch (error) {
            console.warn('[MinecraftJukebox] Failed to clear blob storage', error);
        }

        bg.blobAssetLibrary.clear();
        bg.minecraftAssetState.discIndex.clear();
        bg.minecraftAssetState.latestIndexName = null;
        bg.minecraftAssetState.rootDirectory = null;
        bg.minecraftAssetState.objectsDirectory = null;

        try {
            await chrome.storage.local.remove(DISC_INDEX_STORAGE_KEY);
        } catch (error) {
            console.warn('[MinecraftJukebox] Failed to clear cached disc index', error);
        }

        bg.broadcastDiscCacheCleared();
    };

    bg.hydrateDiscIndexFromStorage = async function hydrateDiscIndexFromStorage() {
        try {
            const stored = await chrome.storage.local.get(DISC_INDEX_STORAGE_KEY);
            const entry = stored?.[DISC_INDEX_STORAGE_KEY];
            if (!entry) {
                return;
            }

            const { discIndex = [], latestIndexName = null } = entry;
            if (Array.isArray(discIndex) && discIndex.length) {
                const reconstructed = discIndex
                    .filter(item => Array.isArray(item) && item.length >= 2)
                    .map(([key, hash]) => {
                        const normalizedKey = typeof key === 'string' ? key : String(key ?? '');
                        const normalizedHash = typeof hash === 'string' ? hash : null;
                        return [normalizedKey, normalizedHash];
                    })
                    .filter(([key, hash]) => key && typeof hash === 'string' && hash.length >= 6);

                if (reconstructed.length) {
                    bg.minecraftAssetState.discIndex = new Map(reconstructed);
                }
            }

            if (latestIndexName) {
                bg.minecraftAssetState.latestIndexName = latestIndexName;
            }
        } catch (error) {
            /* ignore hydration errors */
        }
    };

    bg.beginBlobUploadWait = function beginBlobUploadWait() {
        bg.blobLibraryReady = new Promise(resolve => {
            bg.blobLibraryReadyResolve = resolve;
        });
    };

    bg.finishBlobUploadWait = function finishBlobUploadWait() {
        if (bg.blobLibraryReadyResolve) {
            bg.blobLibraryReadyResolve();
            bg.blobLibraryReadyResolve = null;
        }
    };

    bg.hasDiscLibrary = function hasDiscLibrary() {
        const hasHandles = Boolean(
            bg.minecraftAssetState.objectsDirectory
            && bg.minecraftAssetState.discIndex.size > 0
        );

        return hasHandles || bg.blobAssetLibrary.size > 0;
    };

    bg.resolveAssetKey = function resolveAssetKey(candidate) {
        const desired = toAssetKey(candidate);
        if (!desired) {
            return null;
        }

        if (bg.minecraftAssetState.discIndex.has(desired)) {
            return desired;
        }

        for (const key of bg.minecraftAssetState.discIndex.keys()) {
            if (toAssetKey(key) === desired) {
                return key;
            }
        }

        return bg.minecraftAssetState.discIndex.has(candidate) ? candidate : null;
    };

    bg.releaseBlobAssets = function releaseBlobAssets() {
        for (const entry of bg.blobAssetLibrary.values()) {
            if (!entry?.objectUrl) {
                continue;
            }

            try {
                URL.revokeObjectURL(entry.objectUrl);
            } catch (error) {
                /* ignore revoke errors */
            }
        }

        bg.blobAssetLibrary.clear();
    };

    bg.setDiscLibrary = function setDiscLibrary(assets = {}) {
        const {
            rootDirectory = null,
            objectsDirectory = null,
            discIndex = [],
            latestIndexName = null
        } = assets;

        bg.minecraftAssetState.rootDirectory = rootDirectory || null;
        bg.minecraftAssetState.objectsDirectory = objectsDirectory || null;
        bg.minecraftAssetState.latestIndexName = latestIndexName || null;

        if (objectsDirectory) {
            bg.releaseBlobAssets();
        }

        const entries = Array.isArray(discIndex)
            ? discIndex
            : Object.entries(discIndex || {});

        const newIndex = new Map();
        for (const [key, hash] of entries) {
            if (typeof hash === 'string' && hash.length >= 6) {
                newIndex.set(String(key), hash);
            }
        }

        bg.minecraftAssetState.discIndex = newIndex;

        if (newIndex.size) {
            chrome.storage.local.set({
                [DISC_INDEX_STORAGE_KEY]: {
                    discIndex: Array.from(newIndex.entries()),
                    latestIndexName: bg.minecraftAssetState.latestIndexName || null
                }
            }).catch(() => {});
        } else {
            bg.clearStoredDiscLibrary().catch(() => {
                chrome.storage.local.remove(DISC_INDEX_STORAGE_KEY).catch(() => {});
                bg.broadcastDiscCacheCleared();
            });
        }

        bg.discLibraryReady = Promise.resolve();
    };

    bg.notifyAssetsIssue = function notifyAssetsIssue(message, { level = 'error', discId = null } = {}) {
        const payload = {
            type: 'minecraftAssetsStatus',
            message,
            level,
            discId: discId || undefined
        };

        const maybePromise = chrome.runtime.sendMessage(payload);
        if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => {});
        }
    };

    bg.getDiscFile = async function getDiscFile(assetKey) {
        if (!bg.hasDiscLibrary()) {
            return null;
        }

        const resolvedKey = bg.resolveAssetKey(assetKey);
        if (!resolvedKey) {
            return null;
        }

        const hash = bg.minecraftAssetState.discIndex.get(resolvedKey);
        if (typeof hash !== 'string') {
            return null;
        }

        const objectsHandle = bg.minecraftAssetState.objectsDirectory;
        if (!objectsHandle) {
            return null;
        }

        try {
            const prefix = hash.slice(0, 2);
            const bucketHandle = await objectsHandle.getDirectoryHandle(prefix);
            const fileHandle = await bucketHandle.getFileHandle(hash);
            return await fileHandle.getFile();
        } catch (error) {
            console.warn('Failed to resolve hashed asset', resolvedKey, error);
            return null;
        }
    };

    bg.handleUploadedIndex = async function handleUploadedIndex(message) {
        const assets = message.assets || {};
        const discIndex = Array.isArray(assets.discIndex) ? assets.discIndex : [];
        const latestIndexName = assets.latestIndexName || null;

        bg.releaseBlobAssets();
        bg.expectedBlobKeys = new Set();

        for (const entry of discIndex) {
            if (Array.isArray(entry) && entry.length) {
                bg.expectedBlobKeys.add(String(entry[0]));
            }
        }

        bg.beginBlobUploadWait();
        await bg.storeBlobEntries([]);

        bg.setDiscLibrary({
            rootDirectory: null,
            objectsDirectory: null,
            discIndex,
            latestIndexName
        });

        if (bg.expectedBlobKeys.size === 0) {
            bg.finishBlobUploadWait();
        }

        return { ok: true };
    };

    bg.handleAssetBlob = async function handleAssetBlob(message) {
        const key = typeof message.key === 'string' ? message.key : String(message.key ?? '');
        const base64Data = message.base64Data;
        const mimeType = typeof message.mimeType === 'string' ? message.mimeType : 'audio/ogg';

        if (!key || typeof base64Data !== 'string' || !base64Data) {
            console.error('[MinecraftJukebox] Invalid blob message for key:', key);
            return { ok: false };
        }

        let blob;
        try {
            blob = base64ToBlob(base64Data, mimeType);
        } catch (error) {
            console.error('[MinecraftJukebox] Failed to decode base64 for key:', key, error);
            return { ok: false };
        }

        if (!(blob instanceof Blob)) {
            return { ok: false };
        }

        bg.blobAssetLibrary.set(key, { blob, objectUrl: null });
        bg.expectedBlobKeys.delete(key);

        await bg.storeSingleBlobEntry(key, blob);

        if (bg.expectedBlobKeys.size === 0) {
            bg.finishBlobUploadWait();
        }

        return { ok: true };
    };

    bg.handleUploadComplete = async function handleUploadComplete(message) {
        const keys = Array.isArray(message.keys) ? message.keys.map(item => String(item ?? '')) : [];
        for (const key of keys) {
            bg.expectedBlobKeys.delete(key);
        }

        if (bg.expectedBlobKeys.size === 0) {
            bg.finishBlobUploadWait();
        } else {
            console.warn('[MinecraftJukebox] Missing uploaded disc blobs for keys:', Array.from(bg.expectedBlobKeys));
            bg.expectedBlobKeys.clear();
            bg.finishBlobUploadWait();
        }

        return { completed: true };
    };

    bg.getAssetsResponse = function getAssetsResponse() {
        if (!bg.hasDiscLibrary()) {
            return { assets: null };
        }

        return {
            assets: {
                discIndex: Array.from(bg.minecraftAssetState.discIndex.entries()),
                latestIndexName: bg.minecraftAssetState.latestIndexName,
                objectsDirectory: bg.minecraftAssetState.objectsDirectory,
                hasBlobLibrary: bg.blobAssetLibrary.size > 0
            }
        };
    };

    bg.getDiscBlobResponse = async function getDiscBlobResponse(message) {
        const requestedKey = typeof message.key === 'string' ? message.key : String(message.key ?? '');
        const normalizedKey = toAssetKey(requestedKey) || requestedKey;

        let entry = bg.blobAssetLibrary.get(normalizedKey);
        if (!entry && normalizedKey !== requestedKey) {
            entry = bg.blobAssetLibrary.get(requestedKey);
        }

        const hash = bg.minecraftAssetState.discIndex.get(normalizedKey)
            || bg.minecraftAssetState.discIndex.get(requestedKey)
            || null;

        if (!entry?.blob || !(entry.blob instanceof Blob)) {
            return { key: normalizedKey, base64Data: null, hash: null };
        }

        try {
            return {
                key: normalizedKey,
                base64Data: await blobToBase64(entry.blob),
                mimeType: entry.blob.type || 'audio/ogg',
                hash
            };
        } catch (error) {
            console.error('[MinecraftJukebox] Failed to convert blob to base64:', error);
            return { key: normalizedKey, base64Data: null, hash: null };
        }
    };

    bg.discLibraryReady = bg.hydrateDiscIndexFromStorage();
    bg.blobLibraryReady = bg.hydrateBlobLibraryFromDb();
})();
