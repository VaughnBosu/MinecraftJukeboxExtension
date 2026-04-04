(() => {
    const shared = globalThis.MinecraftJukeboxShared;
    const { clampVolume, isRemoteSource, base64ToBlob } = shared;

    const MAX_VOLUME = 3;
    const BLOB_DB_NAME = 'minecraftJukeboxAssets';
    const BLOB_DB_VERSION = 1;
    const BLOB_STORE_NAME = 'discBlobs';
    const PROGRESS_THROTTLE_MS = 1000;

    let currentlyPlayingAudio = null;
    let currentDiscId = null;
    let currentVolume = 1;
    let audioContext = null;
    let gainNode = null;
    let sourceNode = null;
    let currentBlobUrl = null;
    let lastProgressSentAt = 0;

    function loadBlobFromCache(key) {
        return new Promise(resolve => {
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
                        if (record?.blob instanceof Blob) {
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

    function sendProgressUpdate() {
        const audio = currentlyPlayingAudio;
        safeSendMessage({
            type: 'progress',
            currentTime: audio ? audio.currentTime : 0,
            duration: getDuration(audio),
            isPlaying: Boolean(audio && !audio.paused),
            discId: currentDiscId || undefined
        });
    }

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
        if (!currentBlobUrl) {
            return;
        }

        try {
            URL.revokeObjectURL(currentBlobUrl);
        } catch (error) {
            /* ignore revoke errors */
        }
        currentBlobUrl = null;
    }

    function getDuration(audio) {
        if (!audio) {
            return 0;
        }

        const { duration } = audio;
        return Number.isFinite(duration) && duration > 0 ? duration : 0;
    }

    function clampToDuration(time, audio) {
        if (!audio) {
            return 0;
        }

        const duration = getDuration(audio);
        const lowerBounded = Math.max(time, 0);
        if (duration === 0) {
            return lowerBounded;
        }

        return Math.min(lowerBounded, duration);
    }

    function notifyTrackStopped(reason = 'stopped') {
        safeSendMessage({
            type: 'playbackStopped',
            reason,
            discId: currentDiscId || undefined
        });
        currentDiscId = null;
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
                /* ignore disconnect errors */
            }
            sourceNode = null;
        }

        try {
            sourceNode = audioContext.createMediaElementSource(audio);
            sourceNode.connect(gainNode);
        } catch (error) {
            /* ignore already-connected media elements */
        }
    }

    async function resolvePlayableSource({ source, blob, base64Data, mimeType, cacheKey }) {
        let resolvedSource = source || null;

        if (!resolvedSource && typeof cacheKey === 'string') {
            const cachedBlob = await loadBlobFromCache(cacheKey);
            if (cachedBlob) {
                currentBlobUrl = URL.createObjectURL(cachedBlob);
                return currentBlobUrl;
            }
        }

        if (!resolvedSource && typeof base64Data === 'string') {
            const reconstructedBlob = base64ToBlob(base64Data, mimeType || 'audio/ogg');
            if (reconstructedBlob instanceof Blob) {
                currentBlobUrl = URL.createObjectURL(reconstructedBlob);
                return currentBlobUrl;
            }
        }

        if (!resolvedSource && blob instanceof Blob) {
            currentBlobUrl = URL.createObjectURL(blob);
            return currentBlobUrl;
        }

        if (!resolvedSource) {
            return null;
        }

        return resolvedSource;
    }

    async function playAudio({ source, blob, base64Data, mimeType, volume = 1, discId, cacheKey }) {
        if (currentlyPlayingAudio) {
            detachAudioHandlers(currentlyPlayingAudio);
            currentlyPlayingAudio.pause();
        }

        revokeCurrentBlobUrl();

        let resolvedSource = null;
        try {
            resolvedSource = await resolvePlayableSource({
                source,
                blob,
                base64Data,
                mimeType,
                cacheKey
            });
        } catch (error) {
            console.error('[MinecraftJukebox Offscreen] Failed to resolve audio source for', discId, error);
        }

        if (!resolvedSource) {
            notifyTrackStopped('error');
            return;
        }

        const audio = new Audio();
        audio.preload = 'auto';
        if (isRemoteSource(resolvedSource)) {
            audio.crossOrigin = 'anonymous';
        }
        audio.src = resolvedSource;
        audio.loop = false;
        audio.currentTime = 0;
        currentVolume = clampVolume(volume, { defaultValue: 1, max: MAX_VOLUME });

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

        ensureAudioGraph(audio);
        if (gainNode) {
            gainNode.gain.value = currentVolume;
        }
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
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
        currentVolume = clampVolume(volume, { defaultValue: 1, max: MAX_VOLUME });

        if (gainNode) {
            gainNode.gain.value = currentVolume;
        } else if (audio) {
            audio.volume = Math.min(Math.max(currentVolume, 0), 1);
        }
    }

    function pauseAudio() {
        if (!currentlyPlayingAudio) {
            return;
        }

        currentlyPlayingAudio.pause();
        sendProgressUpdate();
    }

    function resumeAudio() {
        if (!currentlyPlayingAudio) {
            return;
        }

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
        if (!currentlyPlayingAudio) {
            return;
        }

        if (currentlyPlayingAudio.paused) {
            resumeAudio();
        } else {
            pauseAudio();
        }
    }

    function stopAudio() {
        if (!currentlyPlayingAudio) {
            return;
        }

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
        if (!currentlyPlayingAudio) {
            return;
        }

        const audio = currentlyPlayingAudio;
        audio.currentTime = clampToDuration(audio.currentTime + offset, audio);
        sendProgressUpdate();
    }

    function seekTo(time) {
        if (!currentlyPlayingAudio || !Number.isFinite(time)) {
            return;
        }

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

    chrome.runtime.onMessage.addListener(msg => {
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
        }
    });
})();
