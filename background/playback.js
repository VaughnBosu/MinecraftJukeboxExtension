(() => {
    const bg = globalThis.MinecraftJukeboxBackground;
    const shared = globalThis.MinecraftJukeboxShared;
    const {
        sanitizeTrack,
        sanitizeTrackList,
        createPersistedTrack,
        clampVolume,
        isRemoteSource,
        blobToBase64
    } = shared;

    const DEFAULT_VOLUME = 1;
    const MAX_VOLUME = 3;
    const MAX_CONSECUTIVE_ERRORS = 3;
    const ERROR_ADVANCE_DELAY_MS = 500;

    bg.playbackState = {
        currentTrack: null,
        queue: [],
        history: [],
        progress: {
            currentTime: 0,
            duration: 0,
            isPlaying: false
        }
    };

    bg.hasActiveAudioSession = false;
    bg.volumeLevel = DEFAULT_VOLUME;
    bg.consecutiveStreamErrors = 0;

    bg.loadStateFromStorage = async function loadStateFromStorage() {
        try {
            const stored = await chrome.storage.local.get(['playbackState', 'volumeLevel']);
            if (stored?.playbackState) {
                const { currentTrack = null, queue = [], history = [] } = stored.playbackState;
                bg.playbackState.currentTrack = sanitizeTrack(currentTrack);
                bg.playbackState.queue = sanitizeTrackList(queue);
                bg.playbackState.history = sanitizeTrackList(history);
                bg.playbackState.progress = {
                    currentTime: 0,
                    duration: 0,
                    isPlaying: false
                };
                bg.hasActiveAudioSession = false;
            }

            if (typeof stored?.volumeLevel === 'number') {
                bg.volumeLevel = clampVolume(stored.volumeLevel, {
                    defaultValue: DEFAULT_VOLUME,
                    max: MAX_VOLUME
                });
            }
        } catch (error) {
            /* ignore storage load issues */
        }
    };

    bg.createOffscreen = async function createOffscreen() {
        if (await chrome.offscreen.hasDocument()) {
            return;
        }

        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Used to continue playing music after popup is closed.'
        });
    };

    bg.sendToOffscreen = function sendToOffscreen(payload) {
        return chrome.offscreen.hasDocument()
            .then(hasDocument => {
                if (!hasDocument) {
                    return undefined;
                }

                const maybePromise = chrome.runtime.sendMessage(payload);
                if (maybePromise && typeof maybePromise.catch === 'function') {
                    return maybePromise.catch(() => {});
                }

                return undefined;
            })
            .catch(() => {});
    };

    bg.playSound = async function playSound({
        blob = null,
        source = null,
        volume = DEFAULT_VOLUME,
        discId = null,
        assetKey = null
    } = {}) {
        await bg.createOffscreen();
        const payload = { play: { volume, discId } };

        if (blob instanceof Blob && assetKey && bg.blobAssetLibrary.has(assetKey)) {
            payload.play.cacheKey = assetKey;
        } else if (blob instanceof Blob) {
            try {
                payload.play.base64Data = await blobToBase64(blob);
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
    };

    bg.getStateSnapshot = function getStateSnapshot() {
        return {
            currentTrack: createPersistedTrack(bg.playbackState.currentTrack),
            queue: bg.playbackState.queue.map(createPersistedTrack).filter(Boolean),
            history: bg.playbackState.history.map(createPersistedTrack).filter(Boolean),
            progress: { ...bg.playbackState.progress },
            volume: bg.volumeLevel
        };
    };

    bg.persistState = function persistState() {
        const persistedState = {
            currentTrack: createPersistedTrack(bg.playbackState.currentTrack),
            queue: bg.playbackState.queue.map(createPersistedTrack).filter(Boolean),
            history: bg.playbackState.history.map(createPersistedTrack).filter(Boolean)
        };

        return chrome.storage.local.set({
            playbackState: persistedState
        }).catch(() => {});
    };

    bg.broadcastState = function broadcastState() {
        const maybePromise = chrome.runtime.sendMessage({
            type: 'stateUpdate',
            state: bg.getStateSnapshot()
        });

        if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => {});
        }
    };

    bg.updateVolumeStorage = function updateVolumeStorage(level) {
        return chrome.storage.local.set({ volumeLevel: level }).catch(() => {});
    };

    bg.applyVolumeLevel = function applyVolumeLevel(level, { persist = true, notify = true } = {}) {
        const clamped = clampVolume(level, {
            defaultValue: DEFAULT_VOLUME,
            max: MAX_VOLUME
        });

        if (clamped === bg.volumeLevel) {
            if (persist) {
                bg.updateVolumeStorage(clamped);
            }
            return bg.volumeLevel;
        }

        bg.volumeLevel = clamped;

        if (persist) {
            bg.updateVolumeStorage(clamped);
        }

        if (notify) {
            bg.sendToOffscreen({ setVolume: clamped });
            bg.broadcastState();
        }

        return bg.volumeLevel;
    };

    bg.playTrack = async function playTrack(track, { pushCurrentToHistory = true } = {}) {
        const sanitized = sanitizeTrack(track);
        if (!sanitized) {
            return false;
        }

        const { discId, assetKey } = sanitized;
        const primarySource = typeof sanitized.objectUrl === 'string' ? sanitized.objectUrl : null;
        const fallbackQueue = Array.isArray(sanitized.streamFallbacks)
            ? sanitized.streamFallbacks.slice()
            : [];
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
            if (pushCurrentToHistory && bg.playbackState.currentTrack) {
                bg.playbackState.history.push(bg.playbackState.currentTrack);
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

            bg.playbackState.currentTrack = currentTrackRecord;
            bg.playbackState.progress = {
                currentTime: 0,
                duration: 0,
                isPlaying: false
            };

            await bg.playSound({
                source: streamSource,
                volume: bg.volumeLevel,
                discId
            });
            bg.hasActiveAudioSession = true;
            await bg.persistState();
            bg.broadcastState();
            return true;
        }

        let sourceBlob = null;
        const blobEntry = bg.blobAssetLibrary.get(assetKey);
        if (blobEntry?.blob instanceof Blob) {
            sourceBlob = blobEntry.blob;
        }

        let fallbackSource = null;
        if (!sourceBlob) {
            const file = await bg.getDiscFile(assetKey).catch(() => null);
            if (file) {
                sourceBlob = file;
            } else if (primarySource && !isRemoteSource(primarySource)) {
                fallbackSource = primarySource;
            } else {
                console.error(`[MinecraftJukebox] No audio source found for ${discId}`);
                bg.notifyAssetsIssue(`Unable to load audio for ${discId}.`, {
                    level: 'error',
                    discId
                });
                return false;
            }
        }

        if (pushCurrentToHistory && bg.playbackState.currentTrack) {
            bg.playbackState.history.push(bg.playbackState.currentTrack);
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

        bg.playbackState.currentTrack = currentTrackRecord;
        bg.playbackState.progress = {
            currentTime: 0,
            duration: 0,
            isPlaying: false
        };

        await bg.playSound({
            blob: sourceBlob || undefined,
            source: fallbackSource || undefined,
            volume: bg.volumeLevel,
            discId,
            assetKey
        });
        bg.hasActiveAudioSession = true;
        await bg.persistState();
        bg.broadcastState();
        return true;
    };

    bg.advanceQueue = async function advanceQueue({ shouldStopCurrent = false } = {}) {
        const previousTrack = bg.playbackState.currentTrack;

        if (previousTrack) {
            bg.playbackState.history.push(previousTrack);
        }

        while (bg.playbackState.queue.length) {
            const candidate = bg.playbackState.queue[0];
            if (!sanitizeTrack(candidate)) {
                bg.playbackState.queue.shift();
                continue;
            }

            bg.playbackState.queue.shift();
            const played = await bg.playTrack(candidate, { pushCurrentToHistory: false });
            if (played) {
                return;
            }

            break;
        }

        bg.playbackState.currentTrack = null;
        bg.playbackState.progress = {
            currentTime: 0,
            duration: 0,
            isPlaying: false
        };
        bg.hasActiveAudioSession = false;

        if (shouldStopCurrent && previousTrack) {
            bg.sendToOffscreen({ stop: true });
        }

        await bg.persistState();
        bg.broadcastState();
    };

    bg.handleControl = async function handleControl(command, value) {
        switch (command) {
            case 'toggle':
                if (!bg.playbackState.currentTrack) {
                    return;
                }
                if (!bg.hasActiveAudioSession) {
                    await bg.playTrack(bg.playbackState.currentTrack, { pushCurrentToHistory: false });
                    return;
                }
                bg.sendToOffscreen({ toggle: true });
                break;
            case 'pause':
                bg.sendToOffscreen({ pause: true });
                break;
            case 'resume':
                bg.sendToOffscreen({ resume: true });
                break;
            case 'seekRelative':
                bg.sendToOffscreen({ seekRelative: value });
                break;
            case 'seekTo':
                bg.sendToOffscreen({ seekTo: value });
                break;
            default:
                break;
        }
    };

    bg.handlePlayDisc = async function handlePlayDisc(message) {
        const { discId } = message;
        if (!discId) {
            return;
        }

        const providedUrl = typeof message.objectUrl === 'string' ? message.objectUrl : null;
        const resolvedKey = bg.resolveAssetKey(message.assetKey ?? discId)
            || (providedUrl ? shared.toAssetKey(discId) : null);
        const streamFallbacks = Array.isArray(message.streamFallbacks) ? message.streamFallbacks : [];
        const isStream = Boolean(message.isStream);

        if (!bg.hasDiscLibrary() && !providedUrl) {
            bg.notifyAssetsIssue('Select your Minecraft assets folder before playing.', {
                level: 'warning',
                discId
            });
            return;
        }

        if (!resolvedKey && !providedUrl) {
            bg.notifyAssetsIssue(`No local audio found for ${discId}.`, {
                level: 'error',
                discId
            });
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
            bg.notifyAssetsIssue(`Unable to queue ${discId}.`, { level: 'error', discId });
            return;
        }

        const pushHistory = Boolean(
            bg.playbackState.currentTrack
            && bg.playbackState.currentTrack.discId !== discId
        );
        await bg.playTrack(track, { pushCurrentToHistory: pushHistory });
    };

    bg.handleQueueDisc = async function handleQueueDisc(message) {
        const { discId } = message;
        if (!discId) {
            return;
        }

        const providedUrl = typeof message.objectUrl === 'string' ? message.objectUrl : null;
        const resolvedKey = bg.resolveAssetKey(message.assetKey ?? discId)
            || (providedUrl ? shared.toAssetKey(discId) : null);
        const streamFallbacks = Array.isArray(message.streamFallbacks) ? message.streamFallbacks : [];
        const isStream = Boolean(message.isStream);

        if (!bg.hasDiscLibrary() && !providedUrl) {
            bg.notifyAssetsIssue('Select your Minecraft assets folder before adding to the queue.', {
                level: 'warning',
                discId
            });
            return;
        }

        if (!resolvedKey && !providedUrl) {
            bg.notifyAssetsIssue(`No local audio found for ${discId}.`, {
                level: 'error',
                discId
            });
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
            bg.notifyAssetsIssue(`Unable to queue ${discId}.`, { level: 'error', discId });
            return;
        }

        bg.playbackState.queue.push(track);
        if (!bg.playbackState.currentTrack) {
            const next = bg.playbackState.queue.shift();
            if (next) {
                await bg.playTrack(next, { pushCurrentToHistory: false });
                return;
            }
        }

        await bg.persistState();
        bg.broadcastState();
    };

    bg.handleRemoveFromQueue = async function handleRemoveFromQueue(index) {
        if (!Number.isInteger(index) || index < 0 || index >= bg.playbackState.queue.length) {
            return;
        }

        bg.playbackState.queue.splice(index, 1);
        await bg.persistState();
        bg.broadcastState();
    };

    bg.handleReorderQueue = async function handleReorderQueue(fromIndex, toIndex) {
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
            return;
        }
        if (fromIndex < 0 || fromIndex >= bg.playbackState.queue.length) {
            return;
        }
        if (toIndex < 0 || toIndex >= bg.playbackState.queue.length) {
            return;
        }
        if (fromIndex === toIndex) {
            return;
        }

        const [moved] = bg.playbackState.queue.splice(fromIndex, 1);
        bg.playbackState.queue.splice(toIndex, 0, moved);
        await bg.persistState();
        bg.broadcastState();
    };

    bg.handleSkipNext = async function handleSkipNext() {
        if (bg.playbackState.currentTrack || bg.playbackState.queue.length) {
            await bg.advanceQueue({ shouldStopCurrent: true });
        }
    };

    bg.handleSkipPrevious = async function handleSkipPrevious() {
        if (!bg.playbackState.history.length) {
            return;
        }

        const previousTrack = sanitizeTrack(bg.playbackState.history.pop());
        if (bg.playbackState.currentTrack) {
            const currentCopy = sanitizeTrack(bg.playbackState.currentTrack);
            if (currentCopy) {
                bg.playbackState.queue.unshift(currentCopy);
            }
        }

        if (previousTrack) {
            await bg.playTrack(previousTrack, { pushCurrentToHistory: false });
        }
    };

    bg.handleClearQueue = async function handleClearQueue() {
        if (!bg.playbackState.queue.length) {
            return;
        }

        bg.playbackState.queue = [];
        await bg.persistState();
        bg.broadcastState();
    };

    bg.handleProgressUpdate = function handleProgressUpdate(message) {
        const {
            currentTime = 0,
            duration = 0,
            isPlaying = false,
            discId
        } = message;

        bg.playbackState.progress = {
            currentTime,
            duration,
            isPlaying
        };

        if (discId && (!bg.playbackState.currentTrack || bg.playbackState.currentTrack.discId !== discId)) {
            const sanitized = sanitizeTrack({
                discId,
                assetKey: bg.resolveAssetKey(discId) || undefined
            });
            if (sanitized) {
                bg.playbackState.currentTrack = sanitized;
            }
        }
    };

    bg.handlePlaybackStopped = function handlePlaybackStopped(message) {
        const reason = message.reason || 'stopped';

        if (reason === 'error') {
            bg.consecutiveStreamErrors += 1;

            const current = bg.playbackState.currentTrack;
            if (current && isRemoteSource(current.objectUrl)) {
                const remaining = Array.isArray(current.streamFallbacks)
                    ? current.streamFallbacks.slice()
                    : [];

                if (remaining.length) {
                    const nextSource = remaining.shift();
                    bg.playbackState.currentTrack = {
                        discId: current.discId,
                        assetKey: current.assetKey,
                        objectUrl: nextSource,
                        isStream: true
                    };
                    if (remaining.length) {
                        bg.playbackState.currentTrack.streamFallbacks = remaining;
                    }
                    bg.playTrack(bg.playbackState.currentTrack, { pushCurrentToHistory: false }).catch(() => {});
                    return;
                }

                bg.notifyAssetsIssue('Streaming is unavailable right now.', {
                    level: 'warning',
                    discId: current.discId
                });
            }

            if (bg.consecutiveStreamErrors >= MAX_CONSECUTIVE_ERRORS) {
                bg.consecutiveStreamErrors = 0;
                bg.notifyAssetsIssue(
                    'Multiple tracks failed to play. Check your connection or try local assets.',
                    { level: 'warning' }
                );
                bg.playbackState.progress = {
                    currentTime: 0,
                    duration: 0,
                    isPlaying: false
                };
                bg.hasActiveAudioSession = false;
                bg.persistState().then(() => bg.broadcastState()).catch(() => {});
                return;
            }

            setTimeout(() => {
                bg.advanceQueue({ shouldStopCurrent: false }).catch(() => {});
            }, ERROR_ADVANCE_DELAY_MS);
            return;
        }

        if (reason === 'ended') {
            bg.consecutiveStreamErrors = 0;
            bg.advanceQueue({ shouldStopCurrent: false }).catch(() => {});
            return;
        }

        if (reason === 'stopped') {
            bg.consecutiveStreamErrors = 0;
            bg.playbackState.progress = {
                currentTime: 0,
                duration: bg.playbackState.progress.duration,
                isPlaying: false
            };
            bg.hasActiveAudioSession = false;
            bg.persistState().then(() => {
                bg.broadcastState();
            }).catch(() => {});
        }
    };

    bg.stateReady = bg.loadStateFromStorage();
})();
