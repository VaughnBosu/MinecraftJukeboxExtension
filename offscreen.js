const MAX_VOLUME = 3;
const BLOB_DB_NAME = 'minecraftJukeboxAssets';
const BLOB_DB_VERSION = 1;
const BLOB_STORE_NAME = 'discBlobs';

let currentlyPlayingAudio = null;
let currentDiscId = null;
let currentVolume = 1;
let audioContext = null;
let gainNode = null;
let sourceNode = null;
let currentBlobUrl = null;
let currentIsRemoteStream = false;

function loadBlobFromCache(key) {
    return new Promise((resolve) => {
        try {
            const request = indexedDB.open(BLOB_DB_NAME, BLOB_DB_VERSION);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
                    db.createObjectStore(BLOB_STORE_NAME, { keyPath: 'key' });
                }
            };
            request.onsuccess = event => {
                const db = event.target.result;
                const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
                const store = tx.objectStore(BLOB_STORE_NAME);
                const getReq = store.get(key);
                getReq.onsuccess = () => {
                    const record = getReq.result;
                    if (record && record.blob instanceof Blob) {
                        resolve(record.blob);
                    } else {
                        resolve(null);
                    }
                };
                getReq.onerror = () => resolve(null);
            };
            request.onerror = () => resolve(null);
        } catch (error) {
            resolve(null);
        }
    });
}

function safeSendMessage(payload) {
    const maybePromise = chrome.runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
    }
}

let lastProgressSentAt = 0;
const PROGRESS_THROTTLE_MS = 1000;

function throttledProgressUpdate() {
    const now = Date.now();
    if (now - lastProgressSentAt < PROGRESS_THROTTLE_MS) {
        return;
    }
    lastProgressSentAt = now;
    sendProgressUpdate();
}

function immediateProgressUpdate() {
    lastProgressSentAt = Date.now();
    sendProgressUpdate();
}

function attachAudioHandlers(audio) {
    audio.addEventListener('timeupdate', throttledProgressUpdate);
    audio.addEventListener('play', immediateProgressUpdate);
    audio.addEventListener('pause', immediateProgressUpdate);
    audio.addEventListener('loadedmetadata', immediateProgressUpdate);
    audio.addEventListener('ended', handleEnded);
}

function detachAudioHandlers(audio) {
    audio.removeEventListener('timeupdate', throttledProgressUpdate);
    audio.removeEventListener('play', immediateProgressUpdate);
    audio.removeEventListener('pause', immediateProgressUpdate);
    audio.removeEventListener('loadedmetadata', immediateProgressUpdate);
    audio.removeEventListener('ended', handleEnded);
    if (audio._minecraftErrorHandler) {
        audio.removeEventListener('error', audio._minecraftErrorHandler);
        delete audio._minecraftErrorHandler;
    }
    if (audio._minecraftErrorHandled) {
        delete audio._minecraftErrorHandled;
    }
}

function revokeCurrentBlobUrl() {
    if (currentBlobUrl) {
        try {
            URL.revokeObjectURL(currentBlobUrl);
        } catch (error) {
            /* ignore revoke errors */
        }
        currentBlobUrl = null;
    }
}

function getDuration(audio) {
    if (!audio) return 0;
    const { duration } = audio;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function clampToDuration(time, audio) {
    if (!audio) return 0;
    const duration = getDuration(audio);
    const lowerBounded = Math.max(time, 0);
    if (duration === 0) {
        return lowerBounded;
    }
    return Math.min(lowerBounded, duration);
}

function sendProgressUpdate() {
    const audio = currentlyPlayingAudio;
    const payload = {
        type: 'progress',
        currentTime: audio ? audio.currentTime : 0,
        duration: getDuration(audio),
        isPlaying: Boolean(audio && !audio.paused),
        discId: currentDiscId || undefined
    };

    safeSendMessage(payload);
}

function notifyTrackStopped(reason = 'stopped') {
    safeSendMessage({ type: 'playbackStopped', reason, discId: currentDiscId || undefined });
    currentDiscId = null;
}

function clampVolume(value) {
    if (!Number.isFinite(value)) {
        return 1;
    }
    return Math.min(Math.max(value, 0), MAX_VOLUME);
}

function ensureAudioGraph(audio) {
    if (!audioContext) {
        audioContext = new AudioContext();
        gainNode = audioContext.createGain();
        gainNode.gain.value = currentVolume;
        gainNode.connect(audioContext.destination);
    }

    if (sourceNode) {
        try {
            sourceNode.disconnect();
        } catch (error) {
            // Ignore disconnect errors.
        }
        sourceNode = null;
    }

    try {
        sourceNode = audioContext.createMediaElementSource(audio);
        sourceNode.connect(gainNode);
    } catch (error) {
        // If the source was already connected, ignore.
    }
}

async function playAudio({ source, blob, base64Data, mimeType, volume = 1, discId, cacheKey }) {
    if (currentlyPlayingAudio) {
        detachAudioHandlers(currentlyPlayingAudio);
        currentlyPlayingAudio.pause();
    }

    revokeCurrentBlobUrl();

    let resolvedSource = source || null;
    let isRemote = resolvedSource ? /^https?:\/\//i.test(resolvedSource) : false;

    if (!resolvedSource && typeof cacheKey === 'string') {
        const cached = await loadBlobFromCache(cacheKey);
        if (cached) {
            currentBlobUrl = URL.createObjectURL(cached);
            resolvedSource = currentBlobUrl;
            isRemote = false;
        }
    }

    if (!resolvedSource && typeof base64Data === 'string') {
        try {
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const reconstructed = new Blob([bytes], { type: mimeType || 'audio/ogg' });
            currentBlobUrl = URL.createObjectURL(reconstructed);
            resolvedSource = currentBlobUrl;
            isRemote = false;
        } catch (error) {
            console.error('[MinecraftJukebox Offscreen] Failed to decode base64:', error);
        }
    }

    if (!resolvedSource && blob instanceof Blob) {
        currentBlobUrl = URL.createObjectURL(blob);
        resolvedSource = currentBlobUrl;
        isRemote = false;
    }

    if (!resolvedSource) {
        notifyTrackStopped('error');
        return;
    }

    const audio = new Audio();
    if (!isRemote) {
        audio.preload = 'auto';
    }
    audio.src = resolvedSource;
    currentVolume = clampVolume(volume);
    currentIsRemoteStream = isRemote;
    audio.loop = false;
    audio.currentTime = 0;

    attachAudioHandlers(audio);
    const handleError = event => {
        if (audio._minecraftErrorHandled) {
            return;
        }
        audio._minecraftErrorHandled = true;
        console.error('[MinecraftJukebox Offscreen] Audio error for', discId, event?.error || event);
        notifyTrackStopped('error');
        detachAudioHandlers(audio);
        if (currentlyPlayingAudio === audio) {
            currentlyPlayingAudio = null;
        }
        revokeCurrentBlobUrl();
    };
    audio._minecraftErrorHandler = handleError;
    audio.addEventListener('error', handleError);
    currentlyPlayingAudio = audio;
    currentDiscId = discId || currentDiscId;

    if (isRemote) {
        audio.volume = Math.min(Math.max(currentVolume, 0), 1);
    } else {
        ensureAudioGraph(audio);
        if (gainNode) {
            gainNode.gain.value = currentVolume;
        }
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
    }

    sendProgressUpdate();

    audio.play().then(() => {
        sendProgressUpdate();
    }).catch(error => {
        handleError(error);
    });
}

function setVolume(volume) {
    const audio = currentlyPlayingAudio;
    const clamped = clampVolume(volume);
    currentVolume = clamped;
    if (!audio) {
        if (gainNode) {
            gainNode.gain.value = currentVolume;
        }
        return;
    }
    if (currentIsRemoteStream) {
        audio.volume = Math.min(Math.max(currentVolume, 0), 1);
    } else if (gainNode) {
        gainNode.gain.value = currentVolume;
    } else {
        audio.volume = Math.min(Math.max(currentVolume, 0), 1);
    }
}

function pauseAudio() {
    if (!currentlyPlayingAudio) return;
    currentlyPlayingAudio.pause();
    sendProgressUpdate();
}

function resumeAudio() {
    if (!currentlyPlayingAudio) return;
    const audio = currentlyPlayingAudio;
    audio.play().then(sendProgressUpdate).catch(() => {
        notifyTrackStopped('error');
        detachAudioHandlers(audio);
        if (currentlyPlayingAudio === audio) {
            currentlyPlayingAudio = null;
        }
    });
}

function togglePlayback() {
    if (!currentlyPlayingAudio) return;
    if (currentlyPlayingAudio.paused) {
        resumeAudio();
    } else {
        pauseAudio();
    }
}

function stopAudio() {
    if (!currentlyPlayingAudio) return;
    const audio = currentlyPlayingAudio;
    audio.pause();
    audio.currentTime = 0;
    sendProgressUpdate();
    detachAudioHandlers(audio);
    currentlyPlayingAudio = null;
    revokeCurrentBlobUrl();
    notifyTrackStopped('stopped');
}

function seekRelative(offset) {
    if (!currentlyPlayingAudio) return;
    const audio = currentlyPlayingAudio;
    audio.currentTime = clampToDuration(audio.currentTime + offset, audio);
    sendProgressUpdate();
}

function seekTo(time) {
    if (!currentlyPlayingAudio) return;
    if (!Number.isFinite(time)) return;
    const audio = currentlyPlayingAudio;
    audio.currentTime = clampToDuration(time, audio);
    sendProgressUpdate();
}

function handleEnded() {
    sendProgressUpdate();
    if (currentlyPlayingAudio) {
        detachAudioHandlers(currentlyPlayingAudio);
        currentlyPlayingAudio = null;
    }
    revokeCurrentBlobUrl();
    notifyTrackStopped('ended');
}

function getStatus() {
    const audio = currentlyPlayingAudio;
    return {
        currentTime: audio ? audio.currentTime : 0,
        duration: getDuration(audio),
        isPlaying: Boolean(audio && !audio.paused),
        discId: currentDiscId || undefined
    };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.play) {
        playAudio(msg.play);
        return;
    }

    if (msg.pause) {
        pauseAudio();
        return;
    }

    if (msg.resume) {
        resumeAudio();
        return;
    }

    if (msg.toggle) {
        togglePlayback();
        return;
    }

    if (msg.stop) {
        stopAudio();
        return;
    }

    if (typeof msg.seekRelative === 'number') {
        seekRelative(msg.seekRelative);
        return;
    }

    if (typeof msg.seekTo === 'number') {
        seekTo(msg.seekTo);
        return;
    }

    if (typeof msg.setVolume === 'number') {
        setVolume(msg.setVolume);
        return;
    }

    if (msg.type === 'requestStatus') {
        sendResponse(getStatus());
    }
});
