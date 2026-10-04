(() => {
    const bg = globalThis.MinecraftJukeboxBackground;
    const shared = globalThis.MinecraftJukeboxShared;
    const { toAssetKey, base64ToBlob, openBlobDb, sendMessageSafe, BLOB_STORE_NAME } = shared;

    const DISC_INDEX_STORAGE_KEY = 'minecraftDiscIndex';

    bg.messageTypesExpectingResponse = new Set([
        'minecraftAssetsUploadedIndex',
        'minecraftAssetBlob',
        'minecraftAssetsUploadComplete',
        'requestMinecraftAssets',
        'requestState'
    ]);

    bg.discIndex = new Map();
    bg.blobAssetLibrary = new Map();
    bg.expectedBlobKeys = new Set();
    bg.blobLibraryReadyResolve = null;

    let blobDbPromise = null;

    bg.getBlobDb = function getBlobDb() {
        if (!blobDbPromise) {
            blobDbPromise = openBlobDb().then(db => {
                db.onclose = () => {
                    blobDbPromise = null;
                };
                return db;
            });
        }

        return blobDbPromise;
    };

    bg.clearBlobStore = async function clearBlobStore() {
        try {
            const db = await bg.getBlobDb();
            const transaction = db.transaction(BLOB_STORE_NAME, 'readwrite');
            transaction.objectStore(BLOB_STORE_NAME).clear();
            await new Promise((resolve, reject) => {
                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (error) {
            console.warn('[MinecraftJukebox] Failed to clear blob storage', error);
        }
    };

    bg.hydrateBlobLibraryFromDb = async function hydrateBlobLibraryFromDb() {
        let records = [];
        try {
            const db = await bg.getBlobDb();
            const store = db.transaction(BLOB_STORE_NAME, 'readonly').objectStore(BLOB_STORE_NAME);
            records = await new Promise((resolve, reject) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Failed to load blob assets', error);
        }

        bg.blobAssetLibrary.clear();
        for (const record of records) {
            if (record && typeof record.key === 'string' && record.blob instanceof Blob) {
                bg.blobAssetLibrary.set(record.key, record.blob);
            }
        }
    };

    bg.storeSingleBlobEntry = async function storeSingleBlobEntry(key, blob) {
        try {
            const db = await bg.getBlobDb();
            const transaction = db.transaction(BLOB_STORE_NAME, 'readwrite');
            const putRequest = transaction.objectStore(BLOB_STORE_NAME).put({ key, blob });

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

    bg.hydrateDiscIndexFromStorage = async function hydrateDiscIndexFromStorage() {
        try {
            const stored = await chrome.storage.local.get(DISC_INDEX_STORAGE_KEY);
            const discIndex = stored?.[DISC_INDEX_STORAGE_KEY]?.discIndex;
            const valid = (Array.isArray(discIndex) ? discIndex : [])
                .filter(entry => Array.isArray(entry) && typeof entry[1] === 'string' && entry[1].length >= 6);
            if (valid.length) {
                bg.discIndex = new Map(valid);
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
        return bg.blobAssetLibrary.size > 0;
    };

    bg.resolveAssetKey = function resolveAssetKey(candidate) {
        const desired = toAssetKey(candidate);
        return desired && bg.discIndex.has(desired) ? desired : null;
    };

    bg.setDiscLibrary = function setDiscLibrary(discIndex) {
        const entries = Array.isArray(discIndex) ? discIndex : Object.entries(discIndex || {});

        const newIndex = new Map();
        for (const [key, hash] of entries) {
            if (typeof hash === 'string' && hash.length >= 6) {
                newIndex.set(String(key), hash);
            }
        }

        bg.discIndex = newIndex;
        chrome.storage.local.set({
            [DISC_INDEX_STORAGE_KEY]: { discIndex: Array.from(newIndex.entries()) }
        }).catch(() => {});
    };

    bg.notifyAssetsIssue = function notifyAssetsIssue(message, { level = 'error', discId = null } = {}) {
        sendMessageSafe({
            type: 'minecraftAssetsStatus',
            message,
            level,
            discId: discId || undefined
        });
    };

    bg.handleUploadedIndex = async function handleUploadedIndex(message) {
        const discIndex = Array.isArray(message.assets?.discIndex) ? message.assets.discIndex : [];

        bg.blobAssetLibrary.clear();
        bg.expectedBlobKeys = new Set(discIndex
            .filter(entry => Array.isArray(entry) && entry.length)
            .map(entry => String(entry[0])));

        bg.beginBlobUploadWait();
        await bg.clearBlobStore();

        bg.setDiscLibrary(discIndex);

        if (bg.expectedBlobKeys.size === 0) {
            bg.finishBlobUploadWait();
        }

        return { ok: true };
    };

    bg.handleAssetBlob = async function handleAssetBlob(message) {
        const { key, base64Data } = message;
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

        bg.blobAssetLibrary.set(key, blob);
        bg.expectedBlobKeys.delete(key);

        await bg.storeSingleBlobEntry(key, blob);

        if (bg.expectedBlobKeys.size === 0) {
            bg.finishBlobUploadWait();
        }

        return { ok: true };
    };

    bg.handleUploadComplete = async function handleUploadComplete(message) {
        const keys = Array.isArray(message.keys) ? message.keys : [];
        for (const key of keys) {
            bg.expectedBlobKeys.delete(String(key));
        }

        if (bg.expectedBlobKeys.size > 0) {
            console.warn('[MinecraftJukebox] Missing uploaded disc blobs for keys:', Array.from(bg.expectedBlobKeys));
            bg.expectedBlobKeys.clear();
        }

        bg.finishBlobUploadWait();

        return { completed: true };
    };

    bg.getAssetsResponse = function getAssetsResponse() {
        if (!bg.hasDiscLibrary()) {
            return { assets: null };
        }

        return {
            assets: {
                discIndex: Array.from(bg.discIndex.entries()),
                hasBlobLibrary: bg.blobAssetLibrary.size > 0
            }
        };
    };

    bg.discLibraryReady = bg.hydrateDiscIndexFromStorage();
    bg.blobLibraryReady = bg.hydrateBlobLibraryFromDb();
})();
