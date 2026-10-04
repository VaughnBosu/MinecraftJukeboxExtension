(() => {
    const bg = globalThis.MinecraftJukeboxBackground;
    const shared = globalThis.MinecraftJukeboxShared;
    const {
        sanitizeTrack,
        sanitizeTrackList,
        clampVolume,
        isRemoteSource,
        sendMessageSafe
    } = shared;

    const DEFAULT_VOLUME = 1;
    const MAX_CONSECUTIVE_ERRORS = 3;
    const ERROR_ADVANCE_DELAY_MS = 500;
    let creatingOffscreen = null;

    const resetProgress = () => ({ currentTime: 0, duration: 0, isPlaying: false });

    bg.playbackState = {
        currentTrack: null,
        queue: [],
        history: [],
        progress: resetProgress()
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
            }

            if (typeof stored?.volumeLevel === 'number') {
                bg.volumeLevel = clampVolume(stored.volumeLevel);
            }
        } catch (error) {
            /* ignore storage load issues */
        }
    };

    bg.createOffscreen = async function createOffscreen() {
        if (!creatingOffscreen) {
            creatingOffscreen = (async () => {
                if (await chrome.offscreen.hasDocument()) return;
                await chrome.offscreen.createDocument({
                    url: 'src/offscreen/offscreen.html',
                    reasons: ['AUDIO_PLAYBACK'],
                    justification: 'Used to continue playing music after popup is closed.'
                });
            })().finally(() => {
                creatingOffscreen = null;
            });
        }
        await creatingOffscreen;
    };

    bg.sendToOffscreen = sendMessageSafe;

    bg.playSound = async function playSound({ source = null, volume = DEFAULT_VOLUME, discId = null, assetKey = null } = {}) {
        await bg.createOffscreen();
        const play = { volume, discId };

        if (assetKey && bg.blobAssetLibrary.has(assetKey)) {
            play.cacheKey = assetKey;
        }
        if (typeof source === 'string') {
            play.source = source;
        }

        await sendMessageSafe({ play });
    };

    bg.getStateSnapshot = function getStateSnapshot() {
        return {
            currentTrack: sanitizeTrack(bg.playbackState.currentTrack),
            queue: sanitizeTrackList(bg.playbackState.queue),
            history: sanitizeTrackList(bg.playbackState.history),
            progress: { ...bg.playbackState.progress },
            volume: bg.volumeLevel
        };
    };

    bg.persistState = function persistState() {
        const { currentTrack, queue, history } = bg.getStateSnapshot();
        return chrome.storage.local.set({ playbackState: { currentTrack, queue, history } }).catch(() => {});
    };

    bg.broadcastState = function broadcastState() {
        sendMessageSafe({ type: 'stateUpdate', state: bg.getStateSnapshot() });
    };

    bg.applyVolumeLevel = function applyVolumeLevel(level) {
        const clamped = clampVolume(level);
        const changed = clamped !== bg.volumeLevel;

        bg.volumeLevel = clamped;
        chrome.storage.local.set({ volumeLevel: clamped }).catch(() => {});

        if (changed) {
            bg.sendToOffscreen({ setVolume: clamped });
            bg.broadcastState();
        }
    };

    bg.playTrack = async function playTrack(track, { pushCurrentToHistory = true } = {}) {
        const sanitized = sanitizeTrack(track);
        if (!sanitized) {
            return false;
        }

        const { discId, assetKey, objectUrl = null } = sanitized;
        const fallbackQueue = sanitized.streamFallbacks ? sanitized.streamFallbacks.slice() : [];

        let record;
        let source = null;
        if (sanitized.isStream || isRemoteSource(objectUrl)) {
            source = isRemoteSource(objectUrl) ? objectUrl : fallbackQueue.shift();
            if (!source) {
                return false;
            }
            record = { discId, assetKey, objectUrl: source, isStream: true };
            if (fallbackQueue.length) {
                record.streamFallbacks = fallbackQueue;
            }
        } else if (bg.blobAssetLibrary.has(assetKey) || objectUrl) {
            record = sanitized;
            source = bg.blobAssetLibrary.has(assetKey) ? null : objectUrl;
        } else {
            console.error(`[MinecraftJukebox] No audio source found for ${discId}`);
            bg.notifyAssetsIssue(`Unable to load audio for ${discId}.`, { level: 'error', discId });
            return false;
        }

        if (pushCurrentToHistory && bg.playbackState.currentTrack) {
            bg.playbackState.history.push(bg.playbackState.currentTrack);
        }

        bg.playbackState.currentTrack = record;
        bg.playbackState.progress = resetProgress();

        await bg.playSound({
            source: source || undefined,
            volume: bg.volumeLevel,
            discId,
            assetKey: record.isStream ? undefined : assetKey
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
            const candidate = bg.playbackState.queue.shift();
            if (await bg.playTrack(candidate, { pushCurrentToHistory: false })) {
                return;
            }
        }

        bg.playbackState.currentTrack = null;
        bg.playbackState.progress = resetProgress();
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

    function resolveRequestedTrack(message, missingLibraryMessage) {
        const { discId } = message;
        if (!discId) {
            return null;
        }

        const providedUrl = typeof message.objectUrl === 'string' ? message.objectUrl : null;
        const resolvedKey = (isRemoteSource(providedUrl) && shared.toAssetKey(message.assetKey))
            || bg.resolveAssetKey(message.assetKey ?? discId)
            || (providedUrl ? shared.toAssetKey(discId) : null);

        if (!bg.hasDiscLibrary() && !providedUrl) {
            bg.notifyAssetsIssue(missingLibraryMessage, { level: 'warning', discId });
            return null;
        }

        if (!resolvedKey && !providedUrl) {
            bg.notifyAssetsIssue(`No local audio found for ${discId}.`, { level: 'error', discId });
            return null;
        }

        const track = sanitizeTrack({
            discId,
            assetKey: resolvedKey,
            objectUrl: providedUrl,
            streamFallbacks: message.streamFallbacks,
            isStream: Boolean(message.isStream)
        });

        if (!track) {
            bg.notifyAssetsIssue(`Unable to queue ${discId}.`, { level: 'error', discId });
        }

        return track;
    }

    bg.handlePlayDisc = async function handlePlayDisc(message) {
        const track = resolveRequestedTrack(message, 'Select your Minecraft assets folder before playing.');
        if (!track) {
            return;
        }

        const pushHistory = Boolean(
            bg.playbackState.currentTrack
            && bg.playbackState.currentTrack.discId !== track.discId
        );
        await bg.playTrack(track, { pushCurrentToHistory: pushHistory });
    };

    bg.handleQueueDisc = async function handleQueueDisc(message) {
        const track = resolveRequestedTrack(
            message,
            'Select your Minecraft assets folder before adding to the queue.'
        );
        if (!track) {
            return;
        }

        bg.playbackState.queue.push(track);
        if (!bg.playbackState.currentTrack
            && await bg.playTrack(bg.playbackState.queue.shift(), { pushCurrentToHistory: false })) {
            return;
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
        const length = bg.playbackState.queue.length;
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
            || fromIndex === toIndex
            || fromIndex < 0 || fromIndex >= length
            || toIndex < 0 || toIndex >= length) {
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
        const currentCopy = previousTrack ? sanitizeTrack(bg.playbackState.currentTrack) : null;
        if (currentCopy) {
            bg.playbackState.queue.unshift(currentCopy);
        }

        if (previousTrack && await bg.playTrack(previousTrack, { pushCurrentToHistory: false })) {
            return;
        }

        if (currentCopy) {
            bg.playbackState.queue.shift();
        }
        if (previousTrack) {
            bg.playbackState.history.push(previousTrack);
        }

        await bg.persistState();
        bg.broadcastState();
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
        if (message.discId !== bg.playbackState.currentTrack?.discId) return;
        const { currentTime = 0, duration = 0, isPlaying = false } = message;
        bg.playbackState.progress = { currentTime, duration, isPlaying };
        bg.hasActiveAudioSession = true;
    };

    bg.handlePlaybackStopped = function handlePlaybackStopped(message) {
        if (message.discId !== bg.playbackState.currentTrack?.discId) return;
        const reason = message.reason || 'stopped';

        if (reason === 'error') {
            bg.consecutiveStreamErrors += 1;

            const current = bg.playbackState.currentTrack;
            if (current && isRemoteSource(current.objectUrl)) {
                const remaining = current.streamFallbacks ? current.streamFallbacks.slice() : [];

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
                bg.playbackState.progress = resetProgress();
                bg.hasActiveAudioSession = false;
                bg.persistState().then(() => bg.broadcastState()).catch(() => {});
                return;
            }

            const failedTrack = bg.playbackState.currentTrack;
            setTimeout(() => {
                // A user may already have selected a working track during the
                // error delay. Never let an old failure skip that newer choice.
                if (bg.playbackState.currentTrack === failedTrack) {
                    bg.advanceQueue({ shouldStopCurrent: false }).catch(() => {});
                }
            }, ERROR_ADVANCE_DELAY_MS);
            return;
        }

        if (reason === 'ended') {
            bg.consecutiveStreamErrors = 0;
            bg.advanceQueue({ shouldStopCurrent: false }).catch(() => {});
            return;
        }

        bg.consecutiveStreamErrors = 0;
        bg.playbackState.progress = {
            currentTime: 0,
            duration: bg.playbackState.progress.duration,
            isPlaying: false
        };
        bg.hasActiveAudioSession = false;
        bg.persistState().then(() => bg.broadcastState()).catch(() => {});
    };

    bg.stateReady = bg.loadStateFromStorage();
})();
