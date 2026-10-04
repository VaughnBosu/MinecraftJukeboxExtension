(() => {
    const catalog = globalThis.MinecraftJukeboxCatalog;
    const assets = globalThis.MinecraftJukeboxAssets;
    const player = globalThis.MinecraftJukeboxPlayer;

    const SCALE_OPTIONS = ['small', 'medium', 'large'];
    const SCALE_CLASSES = SCALE_OPTIONS.map(option => `scale-${option}`);
    const DEFAULT_SCALE = 'small';
    const isPlayerWindow = new URLSearchParams(location.search).get('window') === '1';
    document.body.classList.toggle('player-window', isPlayerWindow);

    const dom = {
        nowPlayingLabel: document.getElementById('now-playing'),
        playPauseBtn: document.getElementById('play-pause-btn'),
        rewindBtn: document.getElementById('rewind-btn'),
        forwardBtn: document.getElementById('forward-btn'),
        skipPrevBtn: document.getElementById('skip-prev-btn'),
        skipNextBtn: document.getElementById('skip-next-btn'),
        clearQueueBtn: document.getElementById('clear-queue-btn'),
        progressBar: document.getElementById('progress-bar'),
        currentTimeLabel: document.getElementById('current-time'),
        durationLabel: document.getElementById('duration-time'),
        queueList: document.getElementById('queue-list'),
        scaleSelect: document.getElementById('ui-scale-select'),
        popoutBtn: document.getElementById('popout-btn'),
        songsMenuToggle: document.getElementById('songs-menu-toggle'),
        songsMenuPanel: document.getElementById('songs-menu-panel'),
        volumeSlider: document.getElementById('volume-slider'),
        volumeIcon: document.querySelector('.volume-icon'),
        selectAssetsBtn: document.getElementById('select-assets-btn'),
        assetsInfoBtn: document.querySelector('.info-btn'),
        assetsStatusLabel: document.getElementById('assets-status'),
        assetsStatusRow: document.querySelector('.assets-status-row'),
        assetsDirectoryInput: document.getElementById('assets-directory-input'),
        discMenuToggle: document.getElementById('disc-menu-toggle'),
        discMenuPanel: document.getElementById('disc-menu-panel'),
        discsContainer: document.getElementById('discs'),
        getDiscElements: () => Array.from(document.querySelectorAll('.disc'))
    };

    function applyScalePreference(scale = DEFAULT_SCALE, { persist = false } = {}) {
        const normalized = SCALE_OPTIONS.includes(scale) ? scale : DEFAULT_SCALE;
        document.body.classList.remove(...SCALE_CLASSES);
        document.body.classList.add(`scale-${normalized}`);
        dom.scaleSelect.value = normalized;

        if (persist) {
            chrome.storage.local.set({ uiScale: normalized }).catch(() => {});
        }
    }

    function setDiscMenuVisibility(expanded, { persist = true } = {}) {
        if (expanded) {
            dom.discMenuPanel.removeAttribute('hidden');
            dom.discMenuPanel.classList.add('expanded');
            dom.discMenuPanel.scrollTop = 0;
        } else {
            dom.discMenuPanel.setAttribute('hidden', '');
            dom.discMenuPanel.classList.remove('expanded');
        }

        dom.discMenuToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');

        if (persist) {
            chrome.storage.local.set({ discMenuExpanded: Boolean(expanded) }).catch(() => {});
        }
    }

    function createDiscButton(entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'disc';
        button.dataset.discId = entry.discId;
        button.dataset.discLabel = entry.label;
        button.setAttribute('aria-label', `Play ${entry.label}`);
        button.title = entry.label;
        const artwork = document.createElement('img');
        artwork.className = 'disc-image';
        artwork.src = entry.imagePath;
        artwork.alt = '';
        artwork.width = 64;
        artwork.height = 64;
        artwork.draggable = false;
        button.appendChild(artwork);
        return button;
    }

    function setSongsMenuVisibility(expanded, { persist = true } = {}) {
        dom.songsMenuPanel.hidden = !expanded;
        dom.songsMenuToggle.setAttribute('aria-expanded', String(expanded));
        if (persist) {
            chrome.storage.local.set({ songsMenuExpanded: expanded }).catch(() => {});
        }
    }

    function bindUiEvents() {
        dom.scaleSelect.addEventListener('change', event => {
            applyScalePreference(event.target.value, { persist: true });
        });

        dom.discMenuToggle.addEventListener('click', () => {
            const isExpanded = dom.discMenuToggle.getAttribute('aria-expanded') === 'true';
            setDiscMenuVisibility(!isExpanded);
        });

        dom.songsMenuToggle.addEventListener('click', () => {
            setSongsMenuVisibility(dom.songsMenuToggle.getAttribute('aria-expanded') !== 'true');
        });

        dom.popoutBtn.hidden = isPlayerWindow;
        dom.popoutBtn.addEventListener('click', async () => {
            dom.popoutBtn.disabled = true;
            try {
                const result = await chrome.runtime.sendMessage({ type: 'openPlayerWindow', screen: {
                    left: screen.availLeft, top: screen.availTop,
                    width: screen.availWidth, height: screen.availHeight
                } });
                if (!result?.ok) throw new Error('Unable to open player');
            } catch (error) {
                assets.setAssetsStatus('Could not open the player window. Please try again.', 'error');
            } finally {
                dom.popoutBtn.disabled = false;
            }
        });

        document.addEventListener('click', player.handleDiscClick);
        document.addEventListener('contextmenu', player.handleDiscContextMenu);
    }

    function initialize() {
        dom.discsContainer.replaceChildren(...catalog.getPopupDiscs().map(createDiscButton));
        const popupResize = globalThis.MinecraftJukeboxResize.initialize({ scaleSelect: dom.scaleSelect, isPlayerWindow });

        chrome.storage.local.get(['discMenuExpanded', 'songsMenuExpanded', 'uiScale', 'popupSize'], data => {
            if (typeof data?.discMenuExpanded !== 'undefined') {
                setDiscMenuVisibility(Boolean(data.discMenuExpanded), { persist: false });
            }
            if (data?.uiScale) {
                applyScalePreference(data.uiScale, { persist: false });
            }
            setSongsMenuVisibility(Boolean(data?.songsMenuExpanded), { persist: false });
            popupResize.restore(data?.popupSize);
        });

        assets.initialize({
            dom,
            onLibraryReady: ready => {
                if (ready) {
                    player.flushPendingDiscActions();
                }
            }
        });

        player.initialize({ dom, assets });

        globalThis.MinecraftJukeboxSongs.initialize({
            container: document.getElementById('song-list'),
            searchInput: document.getElementById('song-search'),
            countLabel: document.getElementById('song-count'),
            emptyLabel: document.getElementById('song-empty'),
            pagination: document.getElementById('song-pagination'),
            pageRange: document.getElementById('song-page-range'),
            previousPage: document.getElementById('song-page-prev'),
            nextPage: document.getElementById('song-page-next')
        });

        bindUiEvents();

        chrome.runtime.onMessage.addListener(message => {
            assets.handleRuntimeMessage(message);
            player.handleRuntimeMessage(message);
        });

        assets.requestAssetsFromBackground();
    }

    initialize();
})();
