importScripts('shared.js');

const DEFAULT_VOLUME = 1;
const MAX_VOLUME = 3;

const minecraftAssetState = {
    rootDirectory: null,
    objectsDirectory: null,
    discIndex: new Map(),
    latestIndexName: null
};

const blobAssetLibrary = new Map();

function isRemoteSource(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
}

const MESSAGE_TYPES_EXPECTING_RESPONSE = new Set([
    'minecraftAssetsUploadedIndex',
    'minecraftAssetBlob',
    'minecraftAssetsUploadComplete',
    'requestMinecraftAssets',
    'requestDiscBlob',
    'requestState'
]);

const DISC_INDEX_STORAGE_KEY = 'minecraftDiscIndex';
const BLOB_DB_NAME = 'minecraftJukeboxAssets';
const BLOB_DB_VERSION = 1;
const BLOB_STORE_NAME = 'discBlobs';

try {
    chrome.runtime.setUninstallURL('https://forms.gle/7uGTedirTb5FxJT69');
} catch (error) {
    console.warn('[MinecraftJukebox] Failed to set uninstall URL', error);
}

let blobDbPromise = null;

function getBlobDb() {
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
}

async function storeBlobEntries(entries = []) {
    try {
        const db = await getBlobDb();
        const transaction = db.transaction(BLOB_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(BLOB_STORE_NAME);
        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            store.clear().onsuccess = () => {
                for (const [key, blob] of entries) {
                    if (!(blob instanceof Blob)) {
                        continue;
                    }
                    store.put({ key, blob });
                }
            };
        });
    } catch (error) {
        console.warn('[MinecraftJukebox] Failed to persist blob assets', error);
    }
}

async function loadBlobEntries() {
    try {
        const db = await getBlobDb();
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
}

async function hydrateBlobLibraryFromDb() {
    const records = await loadBlobEntries();
    blobAssetLibrary.clear();
    for (const record of records) {
        if (!record || typeof record.key !== 'string' || !(record.blob instanceof Blob)) {
            continue;
        }
        blobAssetLibrary.set(record.key, { blob: record.blob, objectUrl: null });
    }
}

async function storeSingleBlobEntry(key, blob) {
    try {
        const db = await getBlobDb();
        const transaction = db.transaction(BLOB_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(BLOB_STORE_NAME);
        const putRequest = store.put({ key, blob });
        
        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
            putRequest.onerror = () => reject(putRequest.error);
        });
    } catch (error) {
        console.error('[MinecraftJukebox] Failed to persist blob asset for key:', key, error);
        throw error;
    }
}

async function clearStoredDiscLibrary() {
    try {
        const db = await getBlobDb();
        const transaction = db.transaction(BLOB_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(BLOB_STORE_NAME);
        store.clear();
        await new Promise(resolve => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
        });
    } catch (error) {
        console.warn('[MinecraftJukebox] Failed to clear blob storage', error);
    }

    blobAssetLibrary.clear();
    minecraftAssetState.discIndex.clear();
    minecraftAssetState.latestIndexName = null;
    minecraftAssetState.rootDirectory = null;
    minecraftAssetState.objectsDirectory = null;

    try {
        await chrome.storage.local.remove(DISC_INDEX_STORAGE_KEY);
    } catch (error) {
        console.warn('[MinecraftJukebox] Failed to clear cached disc index', error);
    }

    broadcastDiscCacheCleared();
}

function broadcastDiscCacheCleared() {
    const payload = { type: 'minecraftDiscCacheCleared' };
    const maybePromise = chrome.runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
    }
}

async function hydrateDiscIndexFromStorage() {
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
                minecraftAssetState.discIndex = new Map(reconstructed);
            }
        }
        if (latestIndexName) {
            minecraftAssetState.latestIndexName = latestIndexName;
        }
    } catch (error) {
        // ignore hydration errors
    }
}

let expectedBlobKeys = new Set();
let blobLibraryReadyResolve = null;

const playbackState = {
    currentTrack: null,
    queue: [],
    history: [],
    progress: {
        currentTime: 0,
        duration: 0,
        isPlaying: false
    }
};

let discLibraryReady = hydrateDiscIndexFromStorage();
let blobLibraryReady = hydrateBlobLibraryFromDb();

const stateReady = loadStateFromStorage();
let hasActiveAudioSession = false;
let volumeLevel = DEFAULT_VOLUME;
let consecutiveStreamErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;
const ERROR_ADVANCE_DELAY_MS = 500;

function beginBlobUploadWait() {
    blobLibraryReady = new Promise(resolve => {
        blobLibraryReadyResolve = resolve;
    });
}

function finishBlobUploadWait() {
    if (blobLibraryReadyResolve) {
        blobLibraryReadyResolve();
        blobLibraryReadyResolve = null;
    }
}

/* toAssetKey is provided by shared.js via importScripts */

function hasDiscLibrary() {
    const hasHandles = Boolean(minecraftAssetState.objectsDirectory && minecraftAssetState.discIndex.size > 0);
    const hasBlobs = blobAssetLibrary.size > 0;
    return hasHandles || hasBlobs;
}

function resolveAssetKey(candidate) {
    const desired = toAssetKey(candidate);
    if (!desired) {
        return null;
    }
    if (minecraftAssetState.discIndex.has(desired)) {
        return desired;
    }
    for (const key of minecraftAssetState.discIndex.keys()) {
        if (toAssetKey(key) === desired) {
            return key;
        }
    }
    return minecraftAssetState.discIndex.has(candidate) ? candidate : null;
}

function setDiscLibrary(assets = {}) {
    const { rootDirectory = null, objectsDirectory = null, discIndex = [], latestIndexName = null } = assets;
    minecraftAssetState.rootDirectory = rootDirectory || null;
    minecraftAssetState.objectsDirectory = objectsDirectory || null;
    minecraftAssetState.latestIndexName = latestIndexName || null;

    if (objectsDirectory) {
        releaseBlobAssets();
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
    minecraftAssetState.discIndex = newIndex;

    if (newIndex.size) {
        chrome.storage.local.set({
            [DISC_INDEX_STORAGE_KEY]: {
                discIndex: Array.from(newIndex.entries()),
                latestIndexName: minecraftAssetState.latestIndexName || null
            }
        }).catch(() => {});
    } else {
        clearStoredDiscLibrary().catch(() => {
            chrome.storage.local.remove(DISC_INDEX_STORAGE_KEY).catch(() => {});
            broadcastDiscCacheCleared();
        });
    }

    // eslint-disable-next-line require-atomic-updates
    discLibraryReady = Promise.resolve();
}

function notifyAssetsIssue(message, { level = 'error', discId = null } = {}) {
    const payload = { type: 'minecraftAssetsStatus', message, level, discId: discId || undefined };
    const maybePromise = chrome.runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
    }
}

function releaseBlobAssets() {
    for (const entry of blobAssetLibrary.values()) {
        if (entry?.objectUrl) {
            try {
                URL.revokeObjectURL(entry.objectUrl);
            } catch (error) {
                /* ignore revoke errors */
            }
        }
    }
    blobAssetLibrary.clear();
}

async function getDiscFile(assetKey) {
    if (!hasDiscLibrary()) {
        return null;
    }

    const resolvedKey = resolveAssetKey(assetKey);
    if (!resolvedKey) {
        return null;
    }

    const hash = minecraftAssetState.discIndex.get(resolvedKey);
    if (typeof hash !== 'string') {
        return null;
    }

    const objectsHandle = minecraftAssetState.objectsDirectory;
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
}

function sanitizeTrack(track) {
    if (!track || typeof track !== 'object') {
        return null;
    }

    const discId = typeof track.discId === 'string' ? track.discId : null;
    if (!discId) {
        return null;
    }

    const providedAssetKey = typeof track.assetKey === 'string' && track.assetKey ? track.assetKey : null;
    const objectUrl = typeof track.objectUrl === 'string' && track.objectUrl ? track.objectUrl.trim() : null;

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
        if (!trimmed || trimmed === objectUrl) {
            continue;
        }
        if (!isRemoteSource(trimmed)) {
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
    const persisted = { discId: sanitized.discId, assetKey: sanitized.assetKey };
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

function clampVolume(value) {
    if (!Number.isFinite(value)) {
        return DEFAULT_VOLUME;
    }
    return Math.min(Math.max(value, 0), MAX_VOLUME);
}

async function loadStateFromStorage() {
    try {
        const stored = await chrome.storage.local.get(['playbackState', 'volumeLevel']);
        if (stored && stored.playbackState) {
            const { currentTrack = null, queue = [], history = [] } = stored.playbackState;
            playbackState.currentTrack = sanitizeTrack(currentTrack);
            playbackState.queue = sanitizeTrackList(queue);
            playbackState.history = sanitizeTrackList(history);
            playbackState.progress = {
                currentTime: 0,
                duration: 0,
                isPlaying: false
            };
            hasActiveAudioSession = false;
        }
        if (stored && typeof stored.volumeLevel === 'number') {
            volumeLevel = clampVolume(stored.volumeLevel);
        }
    } catch (error) {
        // Ignore storage load issues.
    }
}

async function playSound({ blob = null, source = null, volume = DEFAULT_VOLUME, discId = null, assetKey = null } = {}) {
    await createOffscreen();
    const payload = { play: { volume, discId } };

    if (blob instanceof Blob && assetKey && blobAssetLibrary.has(assetKey)) {
        payload.play.cacheKey = assetKey;
    } else if (blob instanceof Blob) {
        try {
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
            payload.play.base64Data = btoa(binaryString);
            payload.play.mimeType = blob.type || 'audio/ogg';
        } catch (error) {
            console.error('[MinecraftJukebox] Failed to convert blob to base64:', error);
            return;
        }
    }

    if (typeof source === 'string') {
        payload.play.source = source;
    }

    await chrome.runtime.sendMessage(payload).catch(() => {});
}

async function createOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Used to continue playing music after popup is closed.'
    });
}

function sendToOffscreen(payload) {
    return chrome.offscreen.hasDocument()
        .then(hasDocument => {
            if (!hasDocument) {
                return;
            }
            const maybePromise = chrome.runtime.sendMessage(payload);
            if (maybePromise && typeof maybePromise.catch === 'function') {
                return maybePromise.catch(() => {});
            }
            return undefined;
        })
        .catch(() => {});
}

function getStateSnapshot() {
    return {
        currentTrack: createPersistedTrack(playbackState.currentTrack),
        queue: playbackState.queue.map(createPersistedTrack).filter(Boolean),
        history: playbackState.history.map(createPersistedTrack).filter(Boolean),
        progress: { ...playbackState.progress },
        volume: volumeLevel
    };
}

function persistState() {
    const baseState = {
        currentTrack: createPersistedTrack(playbackState.currentTrack),
        queue: playbackState.queue.map(createPersistedTrack).filter(Boolean),
        history: playbackState.history.map(createPersistedTrack).filter(Boolean)
    };

    const operations = [chrome.storage.local.set({ playbackState: baseState }).catch(() => {})];

    if (playbackState.currentTrack) {
        operations.push(chrome.storage.local.set({ currentDiscId: playbackState.currentTrack.discId }).catch(() => {}));
    } else {
        operations.push(chrome.storage.local.remove('currentDiscId').catch(() => {}));
    }

    return Promise.all(operations).catch(() => {});
}

function broadcastState() {
    const snapshot = getStateSnapshot();
    const maybePromise = chrome.runtime.sendMessage({ type: 'stateUpdate', state: snapshot });
    if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
    }
}

function updateVolumeStorage(level) {
    return chrome.storage.local.set({ volumeLevel: level }).catch(() => {});
}

function applyVolumeLevel(level, { persist = true, notify = true } = {}) {
    const clamped = clampVolume(level);
    if (clamped === volumeLevel) {
        if (persist) {
            updateVolumeStorage(clamped);
        }
        return volumeLevel;
    }

    volumeLevel = clamped;

    if (persist) {
        updateVolumeStorage(clamped);
    }

    if (notify) {
        sendToOffscreen({ setVolume: clamped });
        broadcastState();
    }

    return volumeLevel;
}


async function playTrack(track, { pushCurrentToHistory = true } = {}) {
    const sanitized = sanitizeTrack(track);
    if (!sanitized) {
        return false;
    }

    const { discId, assetKey } = sanitized;
    const primarySource = typeof sanitized.objectUrl === 'string' ? sanitized.objectUrl : null;
    const fallbackQueue = Array.isArray(sanitized.streamFallbacks) ? sanitized.streamFallbacks.slice() : [];
    const shouldStream = Boolean(sanitized.isStream) || isRemoteSource(primarySource);

    let streamSource = null;
    if (shouldStream) {
        if (isRemoteSource(primarySource)) {
            streamSource = primarySource;
        } else if (fallbackQueue.length) {
            streamSource = fallbackQueue.shift();
        }
    }

    if (streamSource) {
        if (pushCurrentToHistory && playbackState.currentTrack) {
            playbackState.history.push(playbackState.currentTrack);
        }

        const currentTrackRecord = {
            discId,
            assetKey,
            objectUrl: streamSource,
            isStream: true
        };
        if (fallbackQueue.length) {
            currentTrackRecord.streamFallbacks = fallbackQueue;
        }

        playbackState.currentTrack = currentTrackRecord;
        playbackState.progress = {
            currentTime: 0,
            duration: 0,
            isPlaying: false
        };

        await playSound({ source: streamSource, volume: volumeLevel, discId });
        hasActiveAudioSession = true;
        await persistState();
        broadcastState();
        return true;
    }

    let sourceBlob = null;
    const blobEntry = blobAssetLibrary.get(assetKey);
    if (blobEntry && blobEntry.blob instanceof Blob) {
        sourceBlob = blobEntry.blob;
    }

    let fallbackSource = null;

    if (!sourceBlob) {
        const file = await getDiscFile(assetKey).catch(() => null);
        if (file) {
            sourceBlob = file;
        } else if (primarySource && !isRemoteSource(primarySource)) {
            fallbackSource = primarySource;
        } else {
            console.error(`[MinecraftJukebox] No audio source found for ${discId}`);
            notifyAssetsIssue(`Unable to load audio for ${discId}.`, { level: 'error', discId });
            return false;
        }
    }

    if (pushCurrentToHistory && playbackState.currentTrack) {
        playbackState.history.push(playbackState.currentTrack);
    }

    const currentTrackRecord = { discId, assetKey };
    if (primarySource) {
        currentTrackRecord.objectUrl = primarySource;
    }
    if (sanitized.isStream) {
        currentTrackRecord.isStream = true;
    }
    if (Array.isArray(sanitized.streamFallbacks) && sanitized.streamFallbacks.length) {
        currentTrackRecord.streamFallbacks = sanitized.streamFallbacks.slice();
    }

    playbackState.currentTrack = currentTrackRecord;
    playbackState.progress = {
        currentTime: 0,
        duration: 0,
        isPlaying: false
    };

    await playSound({ blob: sourceBlob || undefined, source: fallbackSource || undefined, volume: volumeLevel, discId, assetKey });
    hasActiveAudioSession = true;
    await persistState();
    broadcastState();
    return true;
}

async function advanceQueue({ shouldStopCurrent = false } = {}) {
    const previousTrack = playbackState.currentTrack;

    if (previousTrack) {
        playbackState.history.push(previousTrack);
    }

    while (playbackState.queue.length) {
        const candidate = playbackState.queue[0];

        // Drop structurally invalid tracks (corrupt/missing data).
        if (!sanitizeTrack(candidate)) {
            playbackState.queue.shift();
            continue;
        }

        // Valid track — attempt playback.
        playbackState.queue.shift();
        const played = await playTrack(candidate, { pushCurrentToHistory: false });
        if (played) {
            return;
        }

        // Valid track but audio source unavailable (e.g. lost file handles).
        // Stop advancing to preserve the remaining queue.
        break;
    }

    playbackState.currentTrack = null;
    playbackState.progress = {
        currentTime: 0,
        duration: 0,
        isPlaying: false
    };
    hasActiveAudioSession = false;
    if (shouldStopCurrent && previousTrack) {
        sendToOffscreen({ stop: true });
    }
    await persistState();
    broadcastState();
}

async function handleControl(command, value) {
    switch (command) {
        case 'toggle':
            if (!playbackState.currentTrack) {
                return;
            }
            if (!hasActiveAudioSession) {
                await playTrack(playbackState.currentTrack, { pushCurrentToHistory: false });
                return;
            }
            sendToOffscreen({ toggle: true });
            break;
        case 'pause':
            sendToOffscreen({ pause: true });
            break;
        case 'resume':
            sendToOffscreen({ resume: true });
            break;
        case 'seekRelative':
            sendToOffscreen({ seekRelative: value });
            break;
        case 'seekTo':
            sendToOffscreen({ seekTo: value });
            break;
        default:
            break;
    }
}

async function handlePlayDisc(message) {
    const { discId } = message;
    if (!discId) return;

    const providedUrl = typeof message.objectUrl === 'string' ? message.objectUrl : null;
    const resolvedKey = resolveAssetKey(message.assetKey ?? discId) || (providedUrl ? toAssetKey(discId) : null);
    const streamFallbacks = Array.isArray(message.streamFallbacks) ? message.streamFallbacks : [];
    const isStream = Boolean(message.isStream);

    if (!hasDiscLibrary() && !providedUrl) {
        notifyAssetsIssue('Select your Minecraft assets folder before playing.', { level: 'warning', discId });
        return;
    }

    if (!resolvedKey && !providedUrl) {
        notifyAssetsIssue(`No local audio found for ${discId}.`, { level: 'error', discId });
        return;
    }

    const track = sanitizeTrack({
        discId,
        assetKey: resolvedKey,
        objectUrl: providedUrl,
        streamFallbacks,
        isStream
    });
    if (!track) {
        notifyAssetsIssue(`Unable to queue ${discId}.`, { level: 'error', discId });
        return;
    }

    const pushHistory = Boolean(playbackState.currentTrack && playbackState.currentTrack.discId !== discId);
    await playTrack(track, { pushCurrentToHistory: pushHistory });
}

async function handleQueueDisc(message) {
    const { discId } = message;
    if (!discId) return;

    const providedUrl = typeof message.objectUrl === 'string' ? message.objectUrl : null;
    const resolvedKey = resolveAssetKey(message.assetKey ?? discId) || (providedUrl ? toAssetKey(discId) : null);
    const streamFallbacks = Array.isArray(message.streamFallbacks) ? message.streamFallbacks : [];
    const isStream = Boolean(message.isStream);

    if (!hasDiscLibrary() && !providedUrl) {
        notifyAssetsIssue('Select your Minecraft assets folder before adding to the queue.', { level: 'warning', discId });
        return;
    }

    if (!resolvedKey && !providedUrl) {
        notifyAssetsIssue(`No local audio found for ${discId}.`, { level: 'error', discId });
        return;
    }

    const track = sanitizeTrack({
        discId,
        assetKey: resolvedKey,
        objectUrl: providedUrl,
        streamFallbacks,
        isStream
    });
    if (!track) {
        notifyAssetsIssue(`Unable to queue ${discId}.`, { level: 'error', discId });
        return;
    }

    playbackState.queue.push(track);
    if (!playbackState.currentTrack) {
        const next = playbackState.queue.shift();
        if (next) {
            await playTrack(next, { pushCurrentToHistory: false });
            return;
        }
    }

    await persistState();
    broadcastState();
}

async function handleRemoveFromQueue(index) {
    if (!Number.isInteger(index) || index < 0 || index >= playbackState.queue.length) return;
    playbackState.queue.splice(index, 1);
    await persistState();
    broadcastState();
}

async function handleReorderQueue(fromIndex, toIndex) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
    if (fromIndex < 0 || fromIndex >= playbackState.queue.length) return;
    if (toIndex < 0 || toIndex >= playbackState.queue.length) return;
    if (fromIndex === toIndex) return;

    const [moved] = playbackState.queue.splice(fromIndex, 1);
    playbackState.queue.splice(toIndex, 0, moved);
    await persistState();
    broadcastState();
}

async function handleSkipNext() {
    if (playbackState.currentTrack || playbackState.queue.length) {
        await advanceQueue({ shouldStopCurrent: true });
    }
}

async function handleSkipPrevious() {
    if (!playbackState.history.length) return;
    const previousTrack = sanitizeTrack(playbackState.history.pop());

    if (playbackState.currentTrack) {
        const currentCopy = sanitizeTrack(playbackState.currentTrack);
        if (currentCopy) {
            playbackState.queue.unshift(currentCopy);
        }
    }
    if (previousTrack) {
        await playTrack(previousTrack, { pushCurrentToHistory: false });
    }
}

async function handleClearQueue() {
    if (!playbackState.queue.length) {
        return;
    }
    playbackState.queue = [];
    await persistState();
    broadcastState();
}

function handleProgressUpdate(message) {
    const { currentTime = 0, duration = 0, isPlaying = false, discId } = message;
    playbackState.progress = {
        currentTime,
        duration,
        isPlaying
    };

    if (discId && (!playbackState.currentTrack || playbackState.currentTrack.discId !== discId)) {
        const sanitized = sanitizeTrack({ discId, assetKey: resolveAssetKey(discId) || undefined });
        if (sanitized) {
            playbackState.currentTrack = sanitized;
        }
    }
}

function handlePlaybackStopped(message) {
    const reason = message.reason || 'stopped';

    if (reason === 'error') {
        consecutiveStreamErrors += 1;

        const current = playbackState.currentTrack;
        if (current && isRemoteSource(current.objectUrl)) {
            const remaining = Array.isArray(current.streamFallbacks) ? current.streamFallbacks.slice() : [];
            if (remaining.length) {
                const nextSource = remaining.shift();
                playbackState.currentTrack = {
                    discId: current.discId,
                    assetKey: current.assetKey,
                    objectUrl: nextSource,
                    isStream: true
                };
                if (remaining.length) {
                    playbackState.currentTrack.streamFallbacks = remaining;
                }
                playTrack(playbackState.currentTrack, { pushCurrentToHistory: false }).catch(() => {});
                return;
            }
            notifyAssetsIssue('Streaming is unavailable right now.', { level: 'warning', discId: current.discId });
        }

        if (consecutiveStreamErrors >= MAX_CONSECUTIVE_ERRORS) {
            consecutiveStreamErrors = 0;
            notifyAssetsIssue('Multiple tracks failed to play. Check your connection or try local assets.', { level: 'warning' });
            playbackState.progress = { currentTime: 0, duration: 0, isPlaying: false };
            hasActiveAudioSession = false;
            persistState().then(() => broadcastState()).catch(() => {});
            return;
        }

        setTimeout(() => {
            advanceQueue({ shouldStopCurrent: false }).catch(() => {});
        }, ERROR_ADVANCE_DELAY_MS);
        return;
    }

    if (reason === 'ended') {
        consecutiveStreamErrors = 0;
        advanceQueue({ shouldStopCurrent: false }).catch(() => {});
        return;
    }

    if (reason === 'stopped') {
        consecutiveStreamErrors = 0;
        playbackState.progress = {
            currentTime: 0,
            duration: playbackState.progress.duration,
            isPlaying: false
        };
        hasActiveAudioSession = false;
        persistState().then(() => {
            broadcastState();
        }).catch(() => {});
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const expectsResponse = MESSAGE_TYPES_EXPECTING_RESPONSE.has(message?.type);
    let didSendResponse = false;
    const safeSendResponse = response => {
        if (didSendResponse) {
            return;
        }
        didSendResponse = true;
        try {
            sendResponse(response);
        } catch (error) {
            console.error('[MinecraftJukebox] Failed to send response for message type:', message?.type, error);
        }
    };

    (async () => {
        await stateReady;
        await discLibraryReady;

        const skipBlobWaitTypes = new Set([
            'minecraftAssetsUploadedIndex',
            'minecraftAssetBlob',
            'minecraftAssetsUploadComplete'
        ]);

        if (!skipBlobWaitTypes.has(message.type)) {
            await blobLibraryReady.catch(() => {});
        }

        switch (message.type) {
            case 'minecraftAssetsSelected':
                setDiscLibrary(message.assets);
                break;
            case 'minecraftAssetsUploadedIndex': {
                const assets = message.assets || {};
                const discIndex = Array.isArray(assets.discIndex) ? assets.discIndex : [];
                const latestIndexName = assets.latestIndexName || null;

                releaseBlobAssets();
                blobAssetLibrary.clear();
                expectedBlobKeys = new Set();

                for (const entry of discIndex) {
                    if (Array.isArray(entry) && entry.length) {
                        expectedBlobKeys.add(String(entry[0]));
                    }
                }

                beginBlobUploadWait();
                await storeBlobEntries([]);

                setDiscLibrary({
                    rootDirectory: null,
                    objectsDirectory: null,
                    discIndex,
                    latestIndexName
                });

                if (expectedBlobKeys.size === 0) {
                    finishBlobUploadWait();
                }

                safeSendResponse({ ok: true });
                return;
            }
            case 'minecraftAssetBlob': {
                const key = typeof message.key === 'string' ? message.key : String(message.key ?? '');
                const base64Data = message.base64Data;
                const mimeType = typeof message.mimeType === 'string' ? message.mimeType : 'audio/ogg';
                
                if (!key || typeof base64Data !== 'string' || !base64Data) {
                    console.error('[MinecraftJukebox] Invalid blob message for key:', key, 'base64Data type:', typeof base64Data);
                    safeSendResponse({ ok: false });
                    return;
                }

                // Reconstruct Blob from base64
                let blob;
                try {
                    const binaryString = atob(base64Data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    blob = new Blob([bytes], { type: mimeType });
                } catch (error) {
                    console.error('[MinecraftJukebox] Failed to decode base64 for key:', key, error);
                    safeSendResponse({ ok: false });
                    return;
                }

                blobAssetLibrary.set(key, { blob: blob, objectUrl: null });
                expectedBlobKeys.delete(key);

                await storeSingleBlobEntry(key, blob);

                if (expectedBlobKeys.size === 0) {
                    finishBlobUploadWait();
                }

                safeSendResponse({ ok: true });
                return;
            }
            case 'minecraftAssetsUploadComplete': {
                const keys = Array.isArray(message.keys) ? message.keys.map(item => String(item ?? '')) : [];
                for (const key of keys) {
                    expectedBlobKeys.delete(key);
                }
                if (expectedBlobKeys.size === 0) {
                    finishBlobUploadWait();
                } else if (expectedBlobKeys.size > 0) {
                    console.warn('[MinecraftJukebox] Missing uploaded disc blobs for keys:', Array.from(expectedBlobKeys));
                    expectedBlobKeys.clear();
                    finishBlobUploadWait();
                }
                safeSendResponse({ completed: true });
                return;
            }
            case 'requestMinecraftAssets': {
                const hasAssets = hasDiscLibrary();
                const responsePayload = hasAssets
                    ? {
                        assets: {
                            discIndex: Array.from(minecraftAssetState.discIndex.entries()),
                            latestIndexName: minecraftAssetState.latestIndexName,
                            objectsDirectory: minecraftAssetState.objectsDirectory,
                            hasBlobLibrary: blobAssetLibrary.size > 0
                        }
                    }
                    : { assets: null };
                safeSendResponse(responsePayload);
                return;
            }
            case 'requestDiscBlob': {
                const requestedKey = typeof message.key === 'string' ? message.key : String(message.key ?? '');
                const normalizedKey = toAssetKey(requestedKey) || requestedKey;
                let entry = blobAssetLibrary.get(normalizedKey);
                if (!entry && normalizedKey !== requestedKey) {
                    entry = blobAssetLibrary.get(requestedKey);
                }
                const hash = minecraftAssetState.discIndex.get(normalizedKey) || minecraftAssetState.discIndex.get(requestedKey) || null;
                if (entry?.blob instanceof Blob) {
                    // Convert Blob to base64 for message passing
                    entry.blob.arrayBuffer().then(arrayBuffer => {
                        const uint8Array = new Uint8Array(arrayBuffer);
                        const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
                        const base64Data = btoa(binaryString);
                        safeSendResponse({ 
                            key: normalizedKey, 
                            base64Data: base64Data,
                            mimeType: entry.blob.type || 'audio/ogg',
                            hash 
                        });
                    }).catch(error => {
                        console.error('[MinecraftJukebox] Failed to convert blob to base64:', error);
                        safeSendResponse({ key: normalizedKey, base64Data: null, hash: null });
                    });
                } else {
                    safeSendResponse({ key: normalizedKey, base64Data: null, hash: null });
                }
                return;
            }
            case 'playDisc':
                await handlePlayDisc(message);
                break;
            case 'queueDisc':
                await handleQueueDisc(message);
                break;
            case 'removeFromQueue':
                await handleRemoveFromQueue(message.index);
                break;
            case 'reorderQueue':
                await handleReorderQueue(message.fromIndex, message.toIndex);
                break;
            case 'skipNext':
                await handleSkipNext();
                break;
            case 'skipPrevious':
                await handleSkipPrevious();
                break;
            case 'clearQueue':
                await handleClearQueue();
                break;
            case 'control':
                await handleControl(message.command, message.value);
                break;
            case 'setVolume':
                applyVolumeLevel(message.volume);
                break;
            case 'requestState':
                safeSendResponse(getStateSnapshot());
                return;
            case 'progress':
                handleProgressUpdate(message);
                break;
            case 'playbackStopped':
                handlePlaybackStopped(message);
                break;
            default:
                break;
        }
    })().catch(error => {
        console.error('[MinecraftJukebox] Failed to process message type:', message?.type, error);
        if (expectsResponse && !didSendResponse) {
            safeSendResponse({ ok: false });
        }
    });
    return expectsResponse;
});

chrome.runtime.onInstalled.addListener(() => {
    persistState();
});
