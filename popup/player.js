(() => {
    const shared = globalThis.MinecraftJukeboxShared;
    const catalog = globalThis.MinecraftJukeboxCatalog;

    const MAX_VOLUME = 3;

    const state = {
        dom: null,
        assets: null,
        onResize: () => {},
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
        if (!chrome?.runtime?.sendMessage) return;
        chrome.runtime.sendMessage(payload, callback);
    }

    function setNowPlayingLabel(discId = null) {
        if (!state.dom?.nowPlayingLabel) return;
        state.dom.nowPlayingLabel.textContent = discId ? `Now Playing: ${discId}` : 'Now Playing:';
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const totalSeconds = Math.floor(seconds);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${String(secs).padStart(2, '0')}`;
    }

    function updatePlayPauseLabel() {
        if (state.dom?.playPauseBtn) {
            state.dom.playPauseBtn.textContent = state.isPlaying ? 'Pause' : 'Play';
        }
    }

    function updateControlsState({
        hasTrack = state.hasActiveTrack,
        hasPrev = state.hasPrevTrack,
        hasNext = state.hasNextTrack
    } = {}) {
        state.hasActiveTrack = hasTrack;
        state.hasPrevTrack = hasPrev;
        state.hasNextTrack = hasNext;

        [state.dom?.playPauseBtn, state.dom?.rewindBtn, state.dom?.forwardBtn].forEach(button => {
            if (button) {
                button.disabled = !state.hasActiveTrack;
            }
        });

        if (state.dom?.progressBar) {
            state.dom.progressBar.disabled = !state.hasActiveTrack || Number(state.dom.progressBar.max) === 0;
        }
        if (state.dom?.skipPrevBtn) {
            state.dom.skipPrevBtn.disabled = !state.hasPrevTrack;
        }
        if (state.dom?.skipNextBtn) {
            state.dom.skipNextBtn.disabled = !state.hasNextTrack;
        }
    }

    function resetProgressDisplay() {
        if (state.dom?.progressBar) {
            state.dom.progressBar.value = 0;
            state.dom.progressBar.max = 0;
        }
        if (state.dom?.currentTimeLabel) {
            state.dom.currentTimeLabel.textContent = '0:00';
        }
        if (state.dom?.durationLabel) {
            state.dom.durationLabel.textContent = '0:00';
        }
        state.isPlaying = false;
        updatePlayPauseLabel();
    }

    function updateVolumeIcon() {
        if (!state.dom?.volumeIcon) return;
        state.dom.volumeIcon.classList.toggle('muted', state.currentVolume <= 0.005);
    }

    function applyStatus(status = {}) {
        const { currentTime = 0, duration = 0, isPlaying: playing = false, discId } = status;

        if (discId) {
            state.activeDiscId = discId;
            setNowPlayingLabel(discId);
        }

        const hasDuration = Number.isFinite(duration) && duration > 0;
        if (hasDuration && state.dom?.progressBar) {
            state.dom.progressBar.max = duration;
            state.dom.durationLabel.textContent = formatTime(duration);
            if (!state.hasActiveTrack) {
                state.dom.progressBar.disabled = true;
            }
        }

        if (!hasDuration && !state.hasActiveTrack && state.dom?.progressBar) {
            state.dom.progressBar.max = 0;
            state.dom.durationLabel.textContent = '0:00';
            state.dom.progressBar.disabled = true;
        }

        if (!state.isUserSeeking && state.dom?.progressBar) {
            const safeTime = hasDuration ? Math.min(currentTime, duration) : currentTime;
            state.dom.progressBar.value = Number.isFinite(safeTime) ? safeTime : 0;
            state.dom.currentTimeLabel.textContent = formatTime(safeTime);
        }

        state.isPlaying = Boolean(playing);
        updatePlayPauseLabel();
    }

    function renderQueue() {
        if (!state.dom?.queueList) return;

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

                const upButton = document.createElement('button');
                upButton.className = 'queue-move-up';
                upButton.dataset.index = String(index);
                upButton.textContent = '⬆';
                upButton.disabled = index === 0;

                const downButton = document.createElement('button');
                downButton.className = 'queue-move-down';
                downButton.dataset.index = String(index);
                downButton.textContent = '⬇';
                downButton.disabled = index === state.queue.length - 1;

                const removeButton = document.createElement('button');
                removeButton.className = 'queue-remove';
                removeButton.dataset.index = String(index);
                removeButton.textContent = '✖';

                controls.appendChild(upButton);
                controls.appendChild(downButton);
                controls.appendChild(removeButton);

                listItem.appendChild(title);
                listItem.appendChild(controls);
                items.push(listItem);
            });
        }

        state.dom.queueList.replaceChildren(...items);
        if (state.dom?.clearQueueBtn) {
            state.dom.clearQueueBtn.disabled = state.queue.length === 0;
        }

        updateControlsState({
            hasTrack: state.hasActiveTrack,
            hasPrev: state.history.length > 0,
            hasNext: state.queue.length > 0
        });

        state.onResize();
    }

    function applyState(nextState = {}) {
        const { currentTrack = null, queue = [], history = [], progress, volume } = nextState;

        state.queue = Array.isArray(queue) ? queue : [];
        state.history = Array.isArray(history) ? history : [];
        renderQueue();

        if (currentTrack?.discId) {
            state.activeDiscId = currentTrack.discId;
            setNowPlayingLabel(currentTrack.discId);
            updateControlsState({
                hasTrack: true,
                hasPrev: state.history.length > 0,
                hasNext: state.queue.length > 0
            });
        } else {
            state.activeDiscId = null;
            setNowPlayingLabel(null);
            updateControlsState({
                hasTrack: false,
                hasPrev: state.history.length > 0,
                hasNext: state.queue.length > 0
            });
            if (!progress || !progress.isPlaying) {
                resetProgressDisplay();
            }
        }

        if (progress) {
            applyStatus(progress);
        }

        if (typeof volume === 'number') {
            const normalized = shared.clampVolume(volume, { defaultValue: 1, max: MAX_VOLUME });
            state.currentVolume = normalized;
            if (normalized > 0.005) {
                state.lastNonZeroVolume = normalized;
            }
            if (state.dom?.volumeSlider) {
                const sliderValue = String(Math.round(normalized * 100));
                if (state.dom.volumeSlider.value !== sliderValue) {
                    state.dom.volumeSlider.value = sliderValue;
                }
            }
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
        if (!action?.discId) return;
        const existingIndex = state.pendingDiscActions.findIndex(item => item.discId === action.discId && item.type === action.type);
        if (existingIndex !== -1) {
            state.pendingDiscActions.splice(existingIndex, 1);
        }
        state.pendingDiscActions.push(action);
    }

    function flushPendingDiscActions() {
        if (!state.assets?.isReady() || !state.pendingDiscActions.length) return;
        const actions = state.pendingDiscActions.splice(0, state.pendingDiscActions.length);
        actions.forEach(action => {
            if (action.type === 'queue') {
                queueDisc(action.discId, { allowRetry: false });
            } else if (action.type === 'play') {
                handleDiscSelection(action.discId, { queueOnly: action.queueOnly, allowRetry: false });
            }
        });
    }

    function handleJukeboxSelection({ queueOnly = false } = {}) {
        const payloads = catalog.buildJukeboxTrackPayloads();
        if (!payloads.length) {
            state.assets?.setAssetsStatus('No tracks available for The Jukebox.', 'error');
            return true;
        }

        payloads.forEach((payload, index) => {
            sendMessage({
                type: queueOnly || index > 0 ? 'queueDisc' : 'playDisc',
                ...payload
            });
        });

        if (queueOnly) {
            state.assets?.setAssetsStatus(`Queued ${payloads.length} tracks from The Jukebox.`, 'success', {
                autoClear: true,
                clearDelay: 4000
            });
        } else {
            state.assets?.setAssetsStatus('');
        }

        return true;
    }

    function queueDisc(discId, { allowRetry = true } = {}) {
        if (!discId) return;
        if (catalog.isJukeboxDisc(discId)) {
            handleJukeboxSelection({ queueOnly: true });
            return;
        }

        const canStreamImmediately = catalog.hasStreamingSource(discId);
        const expectLocalLibrary = state.assets?.hasExpectedLocalLibrary();

        if (!state.assets?.isReady() && !canStreamImmediately) {
            if (allowRetry) {
                enqueuePendingDiscAction({ type: 'queue', discId });
                if (!expectLocalLibrary) {
                    state.assets?.setAssetsStatus(state.assets.withAssetsHint('Upload your Minecraft assets to add this disc.'), 'warning');
                }
            }
            return;
        }

        const entry = state.assets?.resolveDiscEntry(discId, { allowStreaming: canStreamImmediately });
        if (!entry) {
            if (!state.assets?.isReady() && expectLocalLibrary) {
                if (allowRetry) {
                    enqueuePendingDiscAction({ type: 'queue', discId });
                }
            } else if (canStreamImmediately) {
                state.assets?.setAssetsStatus('Streaming isn’t available for this track. Upload your Minecraft assets to play it.', 'warning');
            } else if (!state.assets?.hasDiscLibrary()) {
                state.assets?.setAssetsStatus(state.assets.withAssetsHint('Choose your Minecraft assets folder before adding discs.'), 'warning');
            } else {
                state.assets?.setAssetsStatus(`No local audio found for "${discId}".`, 'error');
            }
            return;
        }

        const payload = { type: 'queueDisc', discId, assetKey: entry.assetKey };
        if (entry.objectUrl) payload.objectUrl = entry.objectUrl;
        if (Array.isArray(entry.streamFallbacks) && entry.streamFallbacks.length) {
            payload.streamFallbacks = entry.streamFallbacks;
        }
        if (entry.isStream) payload.isStream = true;
        sendMessage(payload);
    }

    function handleDiscSelection(discId, { queueOnly = false, allowRetry = true } = {}) {
        if (!discId) return;
        if (catalog.isJukeboxDisc(discId)) {
            handleJukeboxSelection({ queueOnly });
            return;
        }

        const canStreamImmediately = catalog.hasStreamingSource(discId);
        const expectLocalLibrary = state.assets?.hasExpectedLocalLibrary();

        if (!state.assets?.isReady() && !canStreamImmediately) {
            if (allowRetry) {
                enqueuePendingDiscAction({ type: queueOnly ? 'queue' : 'play', discId, queueOnly });
                if (!expectLocalLibrary) {
                    state.assets?.setAssetsStatus(state.assets.withAssetsHint('Upload your Minecraft assets to play this disc.'), 'warning');
                }
            }
            return;
        }

        if (queueOnly) {
            queueDisc(discId, { allowRetry: false });
            return;
        }

        const entry = state.assets?.resolveDiscEntry(discId, { allowStreaming: canStreamImmediately });
        if (!entry) {
            if (!state.assets?.isReady() && expectLocalLibrary) {
                if (allowRetry) {
                    enqueuePendingDiscAction({ type: 'play', discId });
                }
            } else if (canStreamImmediately) {
                state.assets?.setAssetsStatus('Streaming isn’t available for this track. Upload your Minecraft assets to play it.', 'warning');
            } else if (!state.assets?.hasDiscLibrary()) {
                state.assets?.setAssetsStatus(state.assets.withAssetsHint('Choose your Minecraft assets folder to play discs.'), 'warning');
            } else {
                state.assets?.setAssetsStatus(`No local audio found for "${discId}".`, 'error');
            }
            return;
        }

        const payload = { type: 'playDisc', discId, assetKey: entry.assetKey };
        if (entry.objectUrl) payload.objectUrl = entry.objectUrl;
        if (Array.isArray(entry.streamFallbacks) && entry.streamFallbacks.length) {
            payload.streamFallbacks = entry.streamFallbacks;
        }
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
            return;
        }
        if (target.classList.contains('queue-move-up')) {
            sendMessage({ type: 'reorderQueue', fromIndex: index, toIndex: index - 1 });
            return;
        }
        if (target.classList.contains('queue-move-down')) {
            sendMessage({ type: 'reorderQueue', fromIndex: index, toIndex: index + 1 });
        }
    }

    function handleDiscClick(event) {
        const disc = event.target instanceof Element ? event.target.closest('.disc') : null;
        if (!(disc instanceof HTMLElement)) return;
        const discId = disc.getAttribute('data-disc-id');
        if (!discId) return;

        if (disc.classList.contains('disabled')) {
            state.assets?.openDiscHelpPage();
            return;
        }

        const queueOnly = event.shiftKey || event.altKey || event.metaKey;
        handleDiscSelection(discId, { queueOnly });
    }

    function handleDiscContextMenu(event) {
        const disc = event.target instanceof Element ? event.target.closest('.disc') : null;
        if (!(disc instanceof HTMLElement)) return;

        event.preventDefault();
        const discId = disc.getAttribute('data-disc-id');
        if (!discId) return;

        if (disc.classList.contains('disabled')) {
            state.assets?.openDiscHelpPage();
            return;
        }

        queueDisc(discId);
    }

    function bootstrapState() {
        if (!chrome?.storage?.local?.get) {
            renderQueue();
            updateControlsState({ hasTrack: false, hasPrev: false, hasNext: false });
            setNowPlayingLabel(null);
            requestFullState();
            return;
        }

        chrome.storage.local.get(['playbackState', 'volumeLevel'], data => {
            if (typeof data?.volumeLevel === 'number') {
                const normalized = shared.clampVolume(data.volumeLevel, { defaultValue: 1, max: MAX_VOLUME });
                state.currentVolume = normalized;
                if (normalized > 0.005) {
                    state.lastNonZeroVolume = normalized;
                }
                if (state.dom?.volumeSlider) {
                    state.dom.volumeSlider.value = String(Math.round(normalized * 100));
                }
                updateVolumeIcon();
            }

            if (data?.playbackState) {
                applyState(data.playbackState);
            } else {
                renderQueue();
                updateControlsState({ hasTrack: false, hasPrev: false, hasNext: false });
                setNowPlayingLabel(null);
            }

            requestFullState();
            state.onResize();
        });
    }

    function bindEvents() {
        state.dom?.playPauseBtn?.addEventListener('click', () => togglePlayback());
        state.dom?.rewindBtn?.addEventListener('click', () => seekRelative(-10));
        state.dom?.forwardBtn?.addEventListener('click', () => seekRelative(10));
        state.dom?.skipNextBtn?.addEventListener('click', () => sendMessage({ type: 'skipNext' }));
        state.dom?.skipPrevBtn?.addEventListener('click', () => sendMessage({ type: 'skipPrevious' }));
        state.dom?.clearQueueBtn?.addEventListener('click', () => sendMessage({ type: 'clearQueue' }));
        state.dom?.queueList?.addEventListener('click', handleQueueListClick);

        state.dom?.progressBar?.addEventListener('input', event => {
            if (state.dom.progressBar.disabled) return;
            state.isUserSeeking = true;
            state.dom.currentTimeLabel.textContent = formatTime(parseFloat(event.target.value));
        });

        state.dom?.progressBar?.addEventListener('change', event => {
            if (state.dom.progressBar.disabled) {
                state.isUserSeeking = false;
                return;
            }
            const newTime = parseFloat(event.target.value);
            if (Number.isFinite(newTime)) {
                seekTo(newTime);
            }
            state.isUserSeeking = false;
        });

        state.dom?.volumeSlider?.addEventListener('input', event => {
            const value = Number.parseInt(event.target.value, 10);
            if (!Number.isFinite(value)) return;

            const normalized = shared.clampVolume(value / 100, { defaultValue: 1, max: MAX_VOLUME });
            if (Math.abs(normalized - state.currentVolume) < 0.005) return;

            state.currentVolume = normalized;
            if (normalized > 0.005) {
                state.lastNonZeroVolume = normalized;
            }
            sendMessage({ type: 'setVolume', volume: normalized });
            updateVolumeIcon();
        });

        state.dom?.volumeIcon?.addEventListener('click', () => {
            if (state.currentVolume <= 0.005) {
                const restored = state.lastNonZeroVolume > 0.005 ? state.lastNonZeroVolume : 1;
                const clamped = shared.clampVolume(restored, { defaultValue: 1, max: MAX_VOLUME });
                state.currentVolume = clamped;
                if (clamped > 0.005) {
                    state.lastNonZeroVolume = clamped;
                }
                if (state.dom?.volumeSlider) {
                    state.dom.volumeSlider.value = String(Math.round(clamped * 100));
                }
                sendMessage({ type: 'setVolume', volume: clamped });
            } else {
                if (state.currentVolume > 0.005) {
                    state.lastNonZeroVolume = state.currentVolume;
                }
                state.currentVolume = 0;
                if (state.dom?.volumeSlider) {
                    state.dom.volumeSlider.value = '0';
                }
                sendMessage({ type: 'setVolume', volume: 0 });
            }
            updateVolumeIcon();
        });

        window.addEventListener('keydown', event => {
            if (event.defaultPrevented) return;
            const target = event.target;
            if (target instanceof HTMLInputElement
                || target instanceof HTMLTextAreaElement
                || target instanceof HTMLSelectElement
                || target?.isContentEditable) {
                return;
            }

            switch (event.code) {
                case 'Space':
                    event.preventDefault();
                    togglePlayback();
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    seekRelative(-10);
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    seekRelative(10);
                    break;
                default:
                    break;
            }
        });
    }

    function handleRuntimeMessage(message) {
        if (message.type === 'progress') {
            applyStatus(message);
            return;
        }
        if (message.type === 'stateUpdate') {
            applyState(message.state || {});
            state.onResize();
            return;
        }
        if (message.type === 'playbackStopped') {
            requestFullState();
            state.onResize();
        }
    }

    function initialize({ dom, assets, onResize }) {
        state.dom = dom;
        state.assets = assets;
        state.onResize = typeof onResize === 'function' ? onResize : () => {};
        updateVolumeIcon();
        bindEvents();
        bootstrapState();
    }

    globalThis.MinecraftJukeboxPlayer = {
        initialize,
        handleDiscClick,
        handleDiscContextMenu,
        handleRuntimeMessage,
        flushPendingDiscActions,
        requestFullState
    };
})();
