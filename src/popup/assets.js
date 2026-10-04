(() => {
    const shared = globalThis.MinecraftJukeboxShared;
    const catalog = globalThis.MinecraftJukeboxCatalog;

    const ASSET_RECORD_PATTERN = /^minecraft\/sounds\/records\/([^/]+)\.ogg$/;
    const STATUS_VARIANTS = ['error', 'success', 'warning'];

    const PLATFORM = ['mac', 'win', 'linux']
        .find(p => (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase().includes(p)) || 'other';
    const FOLDER_HINTS = {
        mac: '~/Library/Application Support/minecraft/assets',
        win: '%AppData%\\.minecraft\\assets',
        linux: '~/.minecraft/assets',
        other: '.minecraft/assets'
    };
    const HIDDEN_TIPS = {
        mac: 'Press Command+Shift+. to reveal hidden folders such as Library.',
        win: 'Enable "Show hidden items" in File Explorer if the folder is hidden.',
        linux: 'Enable viewing hidden files (Ctrl+H) if needed.'
    };

    const state = {
        dom: null,
        onLibraryReady: () => {},
        assetsStatusClearTimer: null,
        isDiscLibraryReady: false,
        hasPersistedDiscLibrary: false,
        assetsControlsLocked: true,
        backgroundLibraryStatus: 'unknown',
        discHashIndex: new Map(),
        discObjectUrlRegistry: new Map(),
        isLoadingAssets: false
    };

    function withHint(baseMessage, hint) {
        if (!hint) return baseMessage;
        const trimmed = baseMessage.trimEnd();
        return trimmed.endsWith('.')
            ? `${trimmed.slice(0, -1)} (${hint}).`
            : `${baseMessage} (${hint})`;
    }

    function setAssetsStatus(message = '', variant = null, { autoClear = false, clearDelay = 4000 } = {}) {
        const trimmedMessage = String(message ?? '').trim();
        state.dom.assetsStatusLabel.textContent = trimmedMessage;
        state.dom.assetsStatusLabel.classList.remove(...STATUS_VARIANTS);
        state.dom.assetsStatusRow.classList.toggle('hidden', trimmedMessage.length === 0);

        if (variant) {
            state.dom.assetsStatusLabel.classList.add(variant);
        }

        clearTimeout(state.assetsStatusClearTimer);
        state.assetsStatusClearTimer = autoClear ? setTimeout(() => setAssetsStatus(), clearDelay) : null;
    }

    function hasExpectedLocalLibrary() {
        return state.hasPersistedDiscLibrary
            || state.backgroundLibraryStatus === 'present'
            || state.discHashIndex.size > 0;
    }

    function updateDiscAvailabilityIndicators() {
        const expectLocalLibrary = hasExpectedLocalLibrary();
        state.dom.getDiscElements().forEach(disc => {
            const shouldDisable = !state.isDiscLibraryReady
                && !expectLocalLibrary
                && !catalog.canDiscStreamWithoutLibrary(disc.dataset.discId);
            disc.classList.toggle('disabled', shouldDisable);
            if (shouldDisable) {
                disc.setAttribute('aria-disabled', 'true');
            } else {
                disc.removeAttribute('aria-disabled');
            }
        });
    }

    function refreshAssetsControlsLock() {
        const hasReadyLocalAudio = state.isDiscLibraryReady && state.discHashIndex.size > 0;

        if (hasReadyLocalAudio || state.backgroundLibraryStatus === 'present') {
            state.hasPersistedDiscLibrary = true;
            state.assetsControlsLocked = false;
        } else {
            state.hasPersistedDiscLibrary = false;
            state.assetsControlsLocked = state.backgroundLibraryStatus === 'unknown';
        }

        const shouldHide = state.assetsControlsLocked || state.hasPersistedDiscLibrary;
        state.dom.selectAssetsBtn.hidden = shouldHide;
        state.dom.assetsInfoBtn.hidden = shouldHide;
        updateDiscAvailabilityIndicators();
    }

    function releaseDiscObjectUrls() {
        for (const url of state.discObjectUrlRegistry.values()) {
            URL.revokeObjectURL(url);
        }
        state.discObjectUrlRegistry.clear();
    }

    function markDiscLibraryReady(ready) {
        state.isDiscLibraryReady = Boolean(ready);
        if (state.isDiscLibraryReady) {
            state.hasPersistedDiscLibrary = true;
        } else if (state.discHashIndex.size === 0) {
            state.hasPersistedDiscLibrary = false;
        }

        refreshAssetsControlsLock();
        state.onLibraryReady(state.isDiscLibraryReady);
    }

    function resetDiscLibraryState() {
        releaseDiscObjectUrls();
        state.discHashIndex = new Map();
        state.hasPersistedDiscLibrary = false;
        state.backgroundLibraryStatus = 'absent';
        markDiscLibraryReady(false);
        setAssetsStatus();
    }

    function showDiscLibraryMissingWarning() {
        setAssetsStatus(withHint('Local Minecraft discs not found. Choose your Minecraft assets folder again.', FOLDER_HINTS[PLATFORM]), 'warning');
    }

    function normalizeRelativePath(path) {
        if (!path) return '';
        const segments = String(path).replace(/^[.\\/]+/, '').replace(/\\/g, '/').split('/').filter(Boolean);
        const targetIndex = segments.findIndex(segment => {
            const lower = segment.toLowerCase();
            return lower === 'indexes' || lower === 'objects';
        });
        return targetIndex > 0 ? segments.slice(targetIndex).join('/') : segments.join('/');
    }

    function waitForDirectoryUploadSelection(input) {
        return new Promise((resolve, reject) => {
            const handleChange = () => {
                input.removeEventListener('cancel', handleCancel);
                const files = Array.from(input.files);
                input.value = '';
                resolve(files);
            };

            const handleCancel = () => {
                input.removeEventListener('change', handleChange);
                input.value = '';
                reject(new DOMException('Selection cancelled.', 'AbortError'));
            };

            input.addEventListener('change', handleChange, { once: true });
            input.addEventListener('cancel', handleCancel, { once: true });
            input.click();
        });
    }

    function pickLatestIndexFile(files) {
        let latest = null;
        for (const file of files) {
            const path = normalizeRelativePath(file.webkitRelativePath || file.name);
            if (!path.startsWith('indexes/') || !path.endsWith('.json')) continue;
            if (!latest
                || file.lastModified > latest.file.lastModified
                || (file.lastModified === latest.file.lastModified && path > latest.path)) {
                latest = { file, path };
            }
        }
        return latest;
    }

    function collectObjectFiles(files) {
        const objectFiles = new Map();
        for (const file of files) {
            const path = normalizeRelativePath(file.webkitRelativePath || file.name);
            if (path.startsWith('objects/')) {
                objectFiles.set(path, file);
            }
        }
        return objectFiles;
    }

    function extractDiscEntriesFromIndex(indexData) {
        const objects = indexData?.objects;
        if (!objects || typeof objects !== 'object') {
            throw new Error('The selected assets index did not contain an objects map.');
        }

        const discs = [];
        for (const [assetPath, meta] of Object.entries(objects)) {
            const match = ASSET_RECORD_PATTERN.exec(assetPath);
            if (!match) continue;
            if (typeof meta?.hash !== 'string' || meta.hash.length < 6) continue;
            discs.push({ assetKey: match[1], hash: meta.hash });
        }

        if (!discs.length) {
            throw new Error('No music discs were found in the selected assets index.');
        }

        return discs;
    }

    function runtimeSendMessage(payload) {
        return new Promise(resolve => {
            chrome.runtime.sendMessage(payload, response => {
                if (chrome.runtime.lastError) {
                    console.warn('Failed to send message to background:', chrome.runtime.lastError.message);
                    resolve({ ok: false, response: null });
                    return;
                }
                resolve({ ok: true, response });
            });
        });
    }

    async function sendBlobFile(key, file) {
        const base64Data = await shared.blobToBase64(file);
        if (!base64Data) return false;
        const { ok, response } = await runtimeSendMessage({
            type: 'minecraftAssetBlob',
            key,
            base64Data,
            mimeType: file.type || 'audio/ogg'
        });
        return ok && response?.ok === true;
    }

    async function sendUploadedAssetsToBackground(discIndex, blobEntries) {
        const indexMessage = await runtimeSendMessage({
            type: 'minecraftAssetsUploadedIndex',
            assets: { discIndex: Array.from(discIndex.entries()) }
        });

        if (!indexMessage.ok || indexMessage.response?.ok !== true) {
            return { savedCount: 0, failedCount: blobEntries.size };
        }

        const uploadedKeys = [];
        for (const [key, file] of blobEntries) {
            if (await sendBlobFile(key, file)) {
                uploadedKeys.push(key);
            }
        }

        await runtimeSendMessage({ type: 'minecraftAssetsUploadComplete', keys: uploadedKeys });
        return { savedCount: uploadedKeys.length, failedCount: blobEntries.size - uploadedKeys.length };
    }

    async function buildDiscLibraryFromFiles(discs, objectFileMap) {
        const newHashIndex = new Map();
        const newObjectUrls = new Map();
        const blobEntries = new Map();
        let missingCount = 0;

        for (const { assetKey, hash } of discs) {
            const file = objectFileMap.get(`objects/${hash.slice(0, 2)}/${hash}`);
            if (!file) {
                missingCount += 1;
                continue;
            }

            newHashIndex.set(assetKey, hash);
            newObjectUrls.set(assetKey, URL.createObjectURL(file));
            blobEntries.set(assetKey, file);
        }

        if (!newObjectUrls.size) {
            throw new Error('Unable to resolve any music discs from the selected assets.');
        }

        releaseDiscObjectUrls();
        state.discHashIndex = newHashIndex;
        state.discObjectUrlRegistry = newObjectUrls;
        markDiscLibraryReady(true);

        const { savedCount, failedCount } = await sendUploadedAssetsToBackground(newHashIndex, blobEntries);
        return { loadedCount: newHashIndex.size, missingCount, savedCount, failedCount };
    }

    function resolveDiscEntry(discId, { allowStreaming = true } = {}) {
        const desiredKey = shared.toAssetKey(discId);
        if (!desiredKey) return null;

        if (state.discHashIndex.has(desiredKey)) {
            return {
                assetKey: desiredKey,
                objectUrl: state.discObjectUrlRegistry.get(desiredKey) || null
            };
        }

        if (!allowStreaming) return null;
        const [primary, ...fallbacks] = catalog.getStreamingSources(desiredKey);
        if (!primary) return null;
        return { assetKey: desiredKey, objectUrl: primary, streamFallbacks: fallbacks, isStream: true };
    }

    async function handleFileUploadAssetsSelection() {
        if (state.isLoadingAssets) return;

        state.isLoadingAssets = true;
        state.dom.selectAssetsBtn.disabled = true;
        markDiscLibraryReady(false);

        try {
            let statusMessage = withHint('Choose your Minecraft assets folder to unlock every classic disc.', FOLDER_HINTS[PLATFORM]);
            const hiddenTip = HIDDEN_TIPS[PLATFORM];
            if (hiddenTip) {
                statusMessage = `${statusMessage} ${hiddenTip}`;
            }
            setAssetsStatus(statusMessage, 'warning');

            const files = await waitForDirectoryUploadSelection(state.dom.assetsDirectoryInput);
            if (!files.length) {
                setAssetsStatus('Selection cancelled.', 'warning');
                return;
            }

            setAssetsStatus('Preparing discs…', 'warning');
            const latestIndex = pickLatestIndexFile(files);
            if (!latestIndex) {
                setAssetsStatus('No assets index JSON files were found in the selected folder.', 'error');
                return;
            }

            let parsed;
            try {
                parsed = JSON.parse(await latestIndex.file.text());
            } catch (error) {
                setAssetsStatus('Failed to parse the selected assets index JSON.', 'error');
                return;
            }

            setAssetsStatus('Saving discs…', 'warning');
            const results = await buildDiscLibraryFromFiles(extractDiscEntriesFromIndex(parsed), collectObjectFiles(files));

            if (results.missingCount) {
                setAssetsStatus(results.loadedCount > 0 ? 'Loaded discs, but some tracks are missing.' : 'Couldn’t load those discs. Please try again.', 'warning');
            } else if (!results.savedCount) {
                setAssetsStatus('Discs ready now, but upload again to save them.', 'warning');
            } else if (results.failedCount) {
                setAssetsStatus(`Saved ${results.savedCount} discs, but ${results.failedCount} couldn’t be saved. Upload again to retry.`, 'warning');
            } else {
                setAssetsStatus('Disc upload successful.', 'success', { autoClear: true, clearDelay: 6000 });
            }
        } catch (error) {
            if (error?.name === 'AbortError') {
                setAssetsStatus('No folder was picked. Try again when you’re ready.', 'warning');
            } else {
                console.error('Failed to upload assets directory', error);
                setAssetsStatus(error?.message || 'Failed to upload assets directory.', 'error');
            }
        } finally {
            state.isLoadingAssets = false;
            state.dom.selectAssetsBtn.disabled = false;
        }
    }

    function hydrateDiscLibraryFromBackground(assets) {
        if (state.discObjectUrlRegistry.size > 0 || state.isLoadingAssets) return;
        if (!assets.hasBlobLibrary || !Array.isArray(assets.discIndex) || !assets.discIndex.length) return;

        state.discHashIndex = new Map(assets.discIndex);
        markDiscLibraryReady(true);
        setAssetsStatus();
    }

    function requestAssetsFromBackground() {
        if (state.discObjectUrlRegistry.size > 0 || state.isLoadingAssets) return;

        chrome.runtime.sendMessage({ type: 'requestMinecraftAssets' }, response => {
            if (chrome.runtime.lastError) {
                state.backgroundLibraryStatus = 'absent';
                refreshAssetsControlsLock();
                return;
            }

            const hadPersistedLibrary = hasExpectedLocalLibrary();
            const assets = response?.assets;
            if (assets && (assets.discIndex?.length || assets.hasBlobLibrary)) {
                if (assets.discIndex?.length) {
                    state.hasPersistedDiscLibrary = true;
                }
                state.backgroundLibraryStatus = 'present';
                refreshAssetsControlsLock();
                hydrateDiscLibraryFromBackground(assets);
            } else {
                state.backgroundLibraryStatus = 'absent';
                resetDiscLibraryState();
                if (hadPersistedLibrary) {
                    showDiscLibraryMissingWarning();
                }
            }
        });
    }

    function openDiscHelpPage() {
        window.open(chrome.runtime.getURL('src/pages/disc-help.html'), '_blank', 'noopener,noreferrer');
    }

    function handleRuntimeMessage(message) {
        if (message.type === 'minecraftAssetsStatus' && typeof message.message === 'string') {
            const variant = STATUS_VARIANTS.includes(message.level) ? message.level : 'error';
            setAssetsStatus(message.message, variant);
        }
    }

    function initialize({ dom, onLibraryReady }) {
        state.dom = dom;
        state.onLibraryReady = onLibraryReady;

        setAssetsStatus();
        refreshAssetsControlsLock();

        dom.selectAssetsBtn.addEventListener('click', () => {
            handleFileUploadAssetsSelection().catch(() => {});
        });
    }

    globalThis.MinecraftJukeboxAssets = {
        initialize,
        setAssetsStatus,
        withAssetsHint: baseMessage => withHint(baseMessage, FOLDER_HINTS[PLATFORM]),
        hasExpectedLocalLibrary,
        isReady: () => state.isDiscLibraryReady,
        hasDiscLibrary: () => state.discHashIndex.size > 0,
        resolveDiscEntry,
        requestAssetsFromBackground,
        openDiscHelpPage,
        handleRuntimeMessage
    };
})();
