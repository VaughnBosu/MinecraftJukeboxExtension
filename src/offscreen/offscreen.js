(() => {
    const shared = globalThis.MinecraftJukeboxShared;
    const { clampVolume, isRemoteSource, readBlobFromCache, sendMessageSafe } = shared;

    const PROGRESS_THROTTLE_MS = 1000;

    let currentlyPlayingAudio = null;
    let currentDiscId = null;
    let currentVolume = 1;
    let audioContext = null;
    let gainNode = null;
    let sourceNode = null;
    let currentBlobUrl = null;
    let lastProgressSentAt = 0;

    function sendProgressUpdate() {
        const audio = currentlyPlayingAudio;
        sendMessageSafe({
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
    }

    function revokeCurrentBlobUrl() {
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }
    }

    function getDuration(audio) {
        if (!audio) {
            return 0;
        }

        const { duration } = audio;
        return Number.isFinite(duration) && duration > 0 ? duration : 0;
    }

    function clampToDuration(time, audio) {
        const duration = getDuration(audio);
        const lowerBounded = Math.max(time, 0);
        return duration === 0 ? lowerBounded : Math.min(lowerBounded, duration);
    }

    function notifyTrackStopped(reason = 'stopped') {
        sendMessageSafe({ type: 'playbackStopped', reason, discId: currentDiscId });
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
            sourceNode.disconnect();
        }

        sourceNode = audioContext.createMediaElementSource(audio);
        sourceNode.connect(gainNode);
    }

    async function resolvePlayableSource({ source, cacheKey }) {
        if (source) {
            return source;
        }

        if (typeof cacheKey === 'string') {
            const cachedBlob = await readBlobFromCache(cacheKey).catch(() => null);
            if (cachedBlob) {
                currentBlobUrl = URL.createObjectURL(cachedBlob);
                return currentBlobUrl;
            }
        }

        return null;
    }

    async function playAudio({ source, volume = 1, discId, cacheKey }) {
        if (currentlyPlayingAudio) {
            detachAudioHandlers(currentlyPlayingAudio);
            currentlyPlayingAudio.pause();
        }

        revokeCurrentBlobUrl();
        currentDiscId = discId;

        const resolvedSource = await resolvePlayableSource({ source, cacheKey });
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
        currentVolume = clampVolume(volume);

        attachAudioHandlers(audio);

        let errorHandled = false;
        const handleError = event => {
            if (errorHandled || currentlyPlayingAudio !== audio) {
                return;
            }

            errorHandled = true;
            console.error('[MinecraftJukebox Offscreen] Audio error for', discId, event?.error || event);
            notifyTrackStopped('error');
            detachAudioHandlers(audio);
            currentlyPlayingAudio = null;
            revokeCurrentBlobUrl();
        };
        audio.addEventListener('error', handleError);

        currentlyPlayingAudio = audio;
        currentDiscId = discId;

        ensureAudioGraph(audio);
        gainNode.gain.value = currentVolume;
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }

        sendProgressUpdate();

        audio.play().then(sendProgressUpdate).catch(handleError);
    }

    function setVolume(volume) {
        currentVolume = clampVolume(volume);
        if (gainNode) {
            gainNode.gain.value = currentVolume;
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
            if (currentlyPlayingAudio !== audio) return;
            notifyTrackStopped('error');
            detachAudioHandlers(audio);
            currentlyPlayingAudio = null;
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

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.play) {
            // Acknowledge setup after a local blob lookup finishes so a newer
            // play command cannot overtake it. Buffering continues independently.
            playAudio(msg.play).then(() => sendResponse({ ok: true }), error => {
                console.error('[MinecraftJukebox Offscreen] Failed to prepare audio', error);
                notifyTrackStopped('error');
                sendResponse({ ok: false });
            });
            return true;
        } else if (msg.toggle) {
            togglePlayback();
        } else if (msg.stop) {
            stopAudio();
        } else if (typeof msg.seekRelative === 'number') {
            seekRelative(msg.seekRelative);
        } else if (typeof msg.seekTo === 'number') {
            seekTo(msg.seekTo);
        } else if (typeof msg.setVolume === 'number') {
            setVolume(msg.setVolume);
        }
    });
})();
