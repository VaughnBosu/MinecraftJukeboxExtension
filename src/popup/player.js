(() => {
    const shared = globalThis.MinecraftJukeboxShared;
    const catalog = globalThis.MinecraftJukeboxCatalog;

    const state = {
        dom: null,
        assets: null,
        activeDiscId: null,
        isPlaying: false,
        hasActiveTrack: false,
        hasPrevTrack: false,
        hasNextTrack: false,
        isUserSeeking: false,
        queue: [],
        history: [],
        currentVolume: 1,
        lastNonZeroVolume: 1,
        pendingDiscActions: []
    };

    function sendMessage(payload, callback) {
        chrome.runtime.sendMessage(payload, callback);
    }

    function setNowPlayingLabel(discId) {
        state.dom.nowPlayingLabel.textContent = discId ? `Now Playing: ${discId}` : 'Now Playing:';
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const totalSeconds = Math.floor(seconds);
        return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
    }

    function updatePlayPauseLabel() {
        state.dom.playPauseBtn.textContent = state.isPlaying ? 'Pause' : 'Play';
    }

    function updateControlsState({
        hasTrack = state.hasActiveTrack,
        hasPrev = state.hasPrevTrack,
        hasNext = state.hasNextTrack
    } = {}) {
        state.hasActiveTrack = hasTrack;
        state.hasPrevTrack = hasPrev;
        state.hasNextTrack = hasNext;

        [state.dom.playPauseBtn, state.dom.rewindBtn, state.dom.forwardBtn].forEach(button => {
            button.disabled = !state.hasActiveTrack;
        });
        state.dom.progressBar.disabled = !state.hasActiveTrack || Number(state.dom.progressBar.max) === 0;
        state.dom.skipPrevBtn.disabled = !state.hasPrevTrack;
        state.dom.skipNextBtn.disabled = !state.hasNextTrack;
    }

    function resetProgressDisplay() {
        state.dom.progressBar.value = 0;
        state.dom.progressBar.max = 0;
        state.dom.currentTimeLabel.textContent = '0:00';
        state.dom.durationLabel.textContent = '0:00';
        state.isPlaying = false;
        updatePlayPauseLabel();
    }

    function updateVolumeIcon() {
        const muted = state.currentVolume <= 0.005;
        state.dom.volumeIcon.classList.toggle('muted', muted);
        state.dom.volumeIcon.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        state.dom.volumeIcon.setAttribute('aria-pressed', String(muted));
        state.dom.volumeIcon.title = muted ? 'Unmute' : 'Mute';
    }

    function applyVolume(normalized, { send = false } = {}) {
        state.currentVolume = normalized;
        if (normalized > 0.005) {
            state.lastNonZeroVolume = normalized;
        }
        state.dom.volumeSlider.value = String(Math.round(normalized * 100));
        if (send) {
            sendMessage({ type: 'setVolume', volume: normalized });
        }
        updateVolumeIcon();
    }

    function applyStatus(status = {}) {
        const { currentTime = 0, duration = 0, isPlaying: playing = false, discId } = status;

        if (discId) {
            state.activeDiscId = discId;
            setNowPlayingLabel(discId);
        }

        const hasDuration = Number.isFinite(duration) && duration > 0;
        if (hasDuration) {
            state.dom.progressBar.max = duration;
            state.dom.durationLabel.textContent = formatTime(duration);
        } else if (!state.hasActiveTrack) {
            state.dom.progressBar.max = 0;
            state.dom.durationLabel.textContent = '0:00';
        }

        if (!state.isUserSeeking) {
            const safeTime = hasDuration ? Math.min(currentTime, duration) : currentTime;
            state.dom.progressBar.value = Number.isFinite(safeTime) ? safeTime : 0;
            state.dom.currentTimeLabel.textContent = formatTime(safeTime);
        }

        state.isPlaying = Boolean(playing);
        updatePlayPauseLabel();
        updateControlsState();
    }

    function renderQueue() {
        const items = [];
        if (!state.queue.length) {
            const emptyItem = document.createElement('li');
            emptyItem.className = 'empty-queue';
            emptyItem.textContent = 'Queue is empty';
            items.push(emptyItem);
        } else {
            state.queue.forEach((item, index) => {
                const listItem = document.createElement('li');
                listItem.className = 'queue-item';
                listItem.dataset.index = String(index);

                const title = document.createElement('span');
                title.className = 'queue-item-title';
                title.textContent = item.discId;

                const controls = document.createElement('div');
                controls.className = 'queue-item-controls';
                [
                    ['queue-move-up', '⬆', index === 0],
                    ['queue-move-down', '⬇', index === state.queue.length - 1],
                    ['queue-remove', '✖', false]
                ].forEach(([className, glyph, disabled]) => {
                    const button = document.createElement('button');
                    button.className = className;
                    button.dataset.index = String(index);
                    button.textContent = glyph;
                    const action = className === 'queue-remove' ? 'Remove' : className === 'queue-move-up' ? 'Move up' : 'Move down';
                    button.setAttribute('aria-label', `${action} ${item.discId}`);
                    button.disabled = disabled;
                    controls.appendChild(button);
                });

                listItem.appendChild(title);
                listItem.appendChild(controls);
                items.push(listItem);
            });
        }

        state.dom.queueList.replaceChildren(...items);
        state.dom.clearQueueBtn.disabled = state.queue.length === 0;

        updateControlsState({
            hasPrev: state.history.length > 0,
            hasNext: state.queue.length > 0
        });
    }

    function applyState(nextState = {}) {
        const { currentTrack = null, queue = [], history = [], progress, volume } = nextState;

        state.queue = Array.isArray(queue) ? queue : [];
        state.history = Array.isArray(history) ? history : [];
        renderQueue();

        const discId = currentTrack?.discId || null;
        state.activeDiscId = discId;
        setNowPlayingLabel(discId);
        updateControlsState({ hasTrack: Boolean(discId) });
        if (!discId && (!progress || !progress.isPlaying)) {
            resetProgressDisplay();
        }

        if (progress) {
            applyStatus(progress);
        }

        if (typeof volume === 'number') {
            applyVolume(shared.clampVolume(volume));
        }

        updateVolumeIcon();
    }

    function requestFullState() {
        sendMessage({ type: 'requestState' }, response => {
            if (chrome.runtime.lastError) return;
            if (response) {
                applyState(response);
            }
        });
    }

    function seekRelative(offset) {
        if (!state.hasActiveTrack) return;
        sendMessage({ type: 'control', command: 'seekRelative', value: offset });
    }

    function seekTo(time) {
        if (!state.hasActiveTrack) return;
        sendMessage({ type: 'control', command: 'seekTo', value: time });
    }

    function togglePlayback() {
        if (!state.hasActiveTrack) return;
        sendMessage({ type: 'control', command: 'toggle' });
    }

    function enqueuePendingDiscAction(action) {
        state.pendingDiscActions = state.pendingDiscActions.filter(item => item.discId !== action.discId);
        state.pendingDiscActions.push(action);
    }

    function flushPendingDiscActions() {
        if (!state.assets.isReady() || !state.pendingDiscActions.length) return;
        const actions = state.pendingDiscActions.splice(0);
        actions.forEach(action => handleDiscSelection(action.discId, { queueOnly: action.queueOnly, allowRetry: false }));
    }

    function handleJukeboxSelection({ queueOnly = false } = {}) {
        const payloads = catalog.buildJukeboxTrackPayloads();

        payloads.forEach((payload, index) => {
            sendMessage({
                type: queueOnly || index > 0 ? 'queueDisc' : 'playDisc',
                ...payload
            });
        });

        if (queueOnly) {
            state.assets.setAssetsStatus(`Queued ${payloads.length} tracks from The Jukebox.`, 'success', {
                autoClear: true,
                clearDelay: 4000
            });
        } else {
            state.assets.setAssetsStatus('');
        }
    }

    function handleDiscSelection(discId, { queueOnly = false, allowRetry = true } = {}) {
        if (!discId) return;
        if (catalog.isJukeboxDisc(discId)) {
            handleJukeboxSelection({ queueOnly });
            return;
        }

        const canStreamImmediately = catalog.hasStreamingSource(discId);
        const expectLocalLibrary = state.assets.hasExpectedLocalLibrary();

        if (!state.assets.isReady() && !canStreamImmediately) {
            if (allowRetry) {
                enqueuePendingDiscAction({ discId, queueOnly });
                if (!expectLocalLibrary) {
                    state.assets.setAssetsStatus(state.assets.withAssetsHint(queueOnly
                        ? 'Upload your Minecraft assets to add this disc.'
                        : 'Upload your Minecraft assets to play this disc.'), 'warning');
                }
            }
            return;
        }

        const entry = state.assets.resolveDiscEntry(discId, { allowStreaming: canStreamImmediately });
        if (!entry) {
            if (!state.assets.isReady() && expectLocalLibrary) {
                if (allowRetry) {
                    enqueuePendingDiscAction({ discId, queueOnly });
                }
            } else if (canStreamImmediately) {
                state.assets.setAssetsStatus('Streaming isn’t available for this track. Upload your Minecraft assets to play it.', 'warning');
            } else if (!state.assets.hasDiscLibrary()) {
                state.assets.setAssetsStatus(state.assets.withAssetsHint(queueOnly
                    ? 'Choose your Minecraft assets folder before adding discs.'
                    : 'Choose your Minecraft assets folder to play discs.'), 'warning');
            } else {
                state.assets.setAssetsStatus(`No local audio found for "${discId}".`, 'error');
            }
            return;
        }

        const payload = { type: queueOnly ? 'queueDisc' : 'playDisc', discId, assetKey: entry.assetKey };
        if (entry.objectUrl) payload.objectUrl = entry.objectUrl;
        if (entry.streamFallbacks?.length) payload.streamFallbacks = entry.streamFallbacks;
        if (entry.isStream) payload.isStream = true;
        sendMessage(payload);
    }

    function handleQueueListClick(event) {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement) || target.disabled) return;
        const index = Number.parseInt(target.dataset.index, 10);
        if (!Number.isInteger(index)) return;

        if (target.classList.contains('queue-remove')) {
            sendMessage({ type: 'removeFromQueue', index });
        } else if (target.classList.contains('queue-move-up')) {
            sendMessage({ type: 'reorderQueue', fromIndex: index, toIndex: index - 1 });
        } else if (target.classList.contains('queue-move-down')) {
            sendMessage({ type: 'reorderQueue', fromIndex: index, toIndex: index + 1 });
        }
    }

    function handleDiscEvent(event, queueOnly) {
        const disc = event.target instanceof Element ? event.target.closest('.disc') : null;
        if (!(disc instanceof HTMLElement)) return;

        if (event.type === 'contextmenu') {
            event.preventDefault();
        }

        const discId = disc.dataset.discId;
        if (!discId) return;

        if (disc.classList.contains('disabled')) {
            state.assets.openDiscHelpPage();
            return;
        }

        handleDiscSelection(discId, { queueOnly });
    }

    function bindEvents() {
        state.dom.playPauseBtn.addEventListener('click', togglePlayback);
        state.dom.rewindBtn.addEventListener('click', () => seekRelative(-10));
        state.dom.forwardBtn.addEventListener('click', () => seekRelative(10));
        state.dom.skipNextBtn.addEventListener('click', () => sendMessage({ type: 'skipNext' }));
        state.dom.skipPrevBtn.addEventListener('click', () => sendMessage({ type: 'skipPrevious' }));
        state.dom.clearQueueBtn.addEventListener('click', () => sendMessage({ type: 'clearQueue' }));
        state.dom.queueList.addEventListener('click', handleQueueListClick);

        state.dom.progressBar.addEventListener('input', event => {
            state.isUserSeeking = true;
            state.dom.currentTimeLabel.textContent = formatTime(parseFloat(event.target.value));
        });

        state.dom.progressBar.addEventListener('change', event => {
            seekTo(parseFloat(event.target.value));
            state.isUserSeeking = false;
        });

        state.dom.volumeSlider.addEventListener('input', event => {
            const value = Number.parseInt(event.target.value, 10);
            if (!Number.isFinite(value)) return;

            const normalized = shared.clampVolume(value / 100);
            if (Math.abs(normalized - state.currentVolume) < 0.005) return;
            applyVolume(normalized, { send: true });
        });

        state.dom.volumeIcon.addEventListener('click', () => {
            const muted = state.currentVolume <= 0.005;
            applyVolume(muted ? (state.lastNonZeroVolume > 0.005 ? state.lastNonZeroVolume : 1) : 0, { send: true });
        });

        window.addEventListener('keydown', event => {
            if (event.defaultPrevented) return;
            const target = event.target;
            if (target instanceof HTMLInputElement
                || target instanceof HTMLTextAreaElement
                || target instanceof HTMLSelectElement
                || target?.closest('button, a')
                || target?.isContentEditable) {
                return;
            }

            const actions = {
                Space: togglePlayback,
                ArrowLeft: () => seekRelative(-10),
                ArrowRight: () => seekRelative(10)
            };
            const action = actions[event.code];
            if (action) {
                event.preventDefault();
                action();
            }
        });
    }

    function handleRuntimeMessage(message) {
        if (message.type === 'progress') {
            applyStatus(message);
        } else if (message.type === 'stateUpdate') {
            applyState(message.state || {});
        } else if (message.type === 'playbackStopped') {
            requestFullState();
        }
    }

    function initialize({ dom, assets }) {
        state.dom = dom;
        state.assets = assets;
        updateVolumeIcon();
        bindEvents();

        renderQueue();
        updateControlsState({ hasTrack: false, hasPrev: false, hasNext: false });
        setNowPlayingLabel(null);
        requestFullState();
    }

    globalThis.MinecraftJukeboxPlayer = {
        initialize,
        handleDiscClick: event => handleDiscEvent(event, event.shiftKey || event.altKey || event.metaKey),
        handleDiscContextMenu: event => handleDiscEvent(event, true),
        handleRuntimeMessage,
        flushPendingDiscActions
    };
})();
