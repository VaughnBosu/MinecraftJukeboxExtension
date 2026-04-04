(() => {
    const catalog = globalThis.MinecraftJukeboxCatalog;
    const assets = globalThis.MinecraftJukeboxAssets;
    const player = globalThis.MinecraftJukeboxPlayer;

    const SCALE_OPTIONS = ['small', 'medium', 'large'];
    const SCALE_CLASSES = SCALE_OPTIONS.map(option => `scale-${option}`);
    const DEFAULT_SCALE = 'small';
    const PING_ENDPOINT = 'https://lupyhlznsiokxpeqftpg.supabase.co/functions/v1/ping';

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
        volumeSlider: document.getElementById('volume-slider'),
        volumeIcon: document.querySelector('.volume-icon'),
        selectAssetsBtn: document.getElementById('select-assets-btn'),
        assetsInfoBtn: document.querySelector('.info-btn'),
        discPanelActions: document.querySelector('.disc-panel-actions'),
        assetsStatusLabel: document.getElementById('assets-status'),
        assetsStatusRow: document.querySelector('.assets-status-row'),
        assetsDirectoryInput: document.getElementById('assets-directory-input'),
        discMenuToggle: document.getElementById('disc-menu-toggle'),
        discMenuPanel: document.getElementById('disc-menu-panel'),
        discsContainer: document.getElementById('discs'),
        heroDisc: document.querySelector('.hero-disc'),
        getDiscElements: () => Array.from(document.querySelectorAll('.disc'))
    };

    let resizeFrameId = null;

    function resizePopupToContent() {
        if (resizeFrameId !== null) {
            cancelAnimationFrame(resizeFrameId);
        }

        resizeFrameId = requestAnimationFrame(() => {
            resizeFrameId = null;

            const root = document.documentElement;
            const body = document.body;
            const bodyStyles = window.getComputedStyle(body);
            const verticalPadding = parseInt(bodyStyles.paddingTop, 10) + parseInt(bodyStyles.paddingBottom, 10);

            const contentHeight = Math.max(root.scrollHeight, body.scrollHeight) + verticalPadding;
            const contentWidth = Math.max(root.scrollWidth, body.scrollWidth);
            const targetHeight = Math.min(contentHeight, 600);
            const targetWidth = Math.min(Math.max(Math.ceil(contentWidth), 320), 800);
            const widthDelta = window.outerWidth - window.innerWidth;
            const heightDelta = window.outerHeight - window.innerHeight;

            window.resizeTo(
                Math.ceil(targetWidth + widthDelta),
                Math.ceil(targetHeight + heightDelta)
            );
        });
    }

    function applyScalePreference(scale = DEFAULT_SCALE, { persist = false } = {}) {
        const normalized = SCALE_OPTIONS.includes(scale) ? scale : DEFAULT_SCALE;
        document.body.classList.remove(...SCALE_CLASSES);
        document.body.classList.add(`scale-${normalized}`);

        if (dom.scaleSelect && dom.scaleSelect.value !== normalized) {
            dom.scaleSelect.value = normalized;
        }

        if (persist && chrome?.storage?.local?.set) {
            chrome.storage.local.set({ uiScale: normalized }).catch(() => {});
        }

        resizePopupToContent();
    }

    function setDiscMenuVisibility(expanded, { persist = true } = {}) {
        if (!dom.discMenuToggle || !dom.discMenuPanel) return;

        if (expanded) {
            dom.discMenuPanel.removeAttribute('hidden');
            dom.discMenuPanel.classList.add('expanded');
            dom.discMenuPanel.scrollTop = 0;
        } else {
            dom.discMenuPanel.setAttribute('hidden', '');
            dom.discMenuPanel.classList.remove('expanded');
        }

        dom.discMenuToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');

        if (persist && chrome?.storage?.local?.set) {
            chrome.storage.local.set({ discMenuExpanded: Boolean(expanded) }).catch(() => {});
        }

        resizePopupToContent();
    }

    function createDiscButton(entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'disc';
        button.dataset.discId = entry.discId;
        button.dataset.discLabel = entry.label;
        button.setAttribute('aria-label', `Play ${entry.label}`);
        button.title = entry.label;
        button.style.backgroundImage = `url("${entry.imagePath}")`;
        return button;
    }

    function renderDiscGrid() {
        if (!dom.discsContainer) return;
        const buttons = catalog.getPopupDiscs().map(createDiscButton);
        dom.discsContainer.replaceChildren(...buttons);

        if (dom.heroDisc) {
            dom.heroDisc.dataset.discLabel = 'The Jukebox';
            dom.heroDisc.title = 'The Jukebox';
        }
    }

    function pingOnPopupOpen() {
        if (!PING_ENDPOINT) return;
        fetch(PING_ENDPOINT, { method: 'GET', cache: 'no-store' }).catch(() => {});
    }

    function bindUiEvents() {
        dom.scaleSelect?.addEventListener('change', event => {
            applyScalePreference(event.target.value, { persist: true });
        });

        dom.discMenuToggle?.addEventListener('click', () => {
            const isExpanded = dom.discMenuToggle.getAttribute('aria-expanded') === 'true';
            setDiscMenuVisibility(!isExpanded);
        });

        document.addEventListener('click', player.handleDiscClick);
        document.addEventListener('contextmenu', player.handleDiscContextMenu);
    }

    function hydrateUiPreferences() {
        setDiscMenuVisibility(false, { persist: false });
        applyScalePreference(DEFAULT_SCALE);

        if (!chrome?.storage?.local?.get) return;
        chrome.storage.local.get(['discMenuExpanded', 'uiScale'], data => {
            if (typeof data?.discMenuExpanded !== 'undefined') {
                setDiscMenuVisibility(Boolean(data.discMenuExpanded), { persist: false });
            }
            if (data?.uiScale) {
                applyScalePreference(data.uiScale, { persist: false });
            }
        });
    }

    function initialize() {
        renderDiscGrid();
        hydrateUiPreferences();

        assets.initialize({
            dom,
            onResize: resizePopupToContent,
            onLibraryReady: ready => {
                if (ready) {
                    player.flushPendingDiscActions();
                }
            }
        });

        player.initialize({
            dom,
            assets,
            onResize: resizePopupToContent
        });

        bindUiEvents();

        chrome.runtime.onMessage.addListener(message => {
            assets.handleRuntimeMessage(message);
            player.handleRuntimeMessage(message);
        });

        assets.requestAssetsFromBackground();

        window.addEventListener('load', () => {
            pingOnPopupOpen();
            resizePopupToContent();
        });
    }

    initialize();
})();
