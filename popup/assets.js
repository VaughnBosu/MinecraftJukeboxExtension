(() => {
    const shared = globalThis.MinecraftJukeboxShared;
    const catalog = globalThis.MinecraftJukeboxCatalog;

    const ASSET_RECORD_PATTERN = /^minecraft\/sounds\/records\/([^/]+)\.ogg$/;
    const STATUS_VARIANTS = ['error', 'success', 'warning'];
    const DEFAULT_ASSETS_STATUS = '';

    const state = {
        dom: null,
        onResize: () => {},
        onLibraryReady: () => {},
        assetsStatusClearTimer: null,
        isDiscLibraryReady: false,
        hasPersistedDiscLibrary: false,
        assetsControlsLocked: true,
        storageLibraryStatus: 'unknown',
        backgroundLibraryStatus: 'unknown',
        minecraftAssetsHandles: null,
        discHashIndex: new Map(),
        discObjectUrlRegistry: new Map(),
        isLoadingAssets: false
    };

    function detectPlatform() {
        const uaDataPlatform = navigator.userAgentData?.platform;
        const platform = (uaDataPlatform || navigator.platform || '').toLowerCase();
        if (platform.includes('mac')) return 'mac';
        if (platform.includes('win')) return 'windows';
        if (platform.includes('linux')) return 'linux';
        return 'other';
    }

    const PLATFORM_KEY = detectPlatform();

    function getDiscElements() {
        return state.dom?.getDiscElements ? state.dom.getDiscElements() : [];
    }

    function withHint(baseMessage, hint) {
        if (!hint) return baseMessage;
        const trimmed = baseMessage.trimEnd();
        return trimmed.endsWith('.')
            ? `${trimmed.slice(0, -1)} (${hint}).`
            : `${baseMessage} (${hint})`;
    }

    function setAssetsStatus(message = DEFAULT_ASSETS_STATUS, variant = null, { autoClear = false, clearDelay = 4000 } = {}) {
        if (!state.dom?.assetsStatusLabel) return;

        const trimmedMessage = String(message ?? '').trim();
        state.dom.assetsStatusLabel.textContent = trimmedMessage;
        state.dom.assetsStatusLabel.classList.remove(...STATUS_VARIANTS);

        if (state.dom.assetsStatusRow) {
            state.dom.assetsStatusRow.classList.toggle('hidden', trimmedMessage.length === 0);
        }

        if (variant && STATUS_VARIANTS.includes(variant)) {
            state.dom.assetsStatusLabel.classList.add(variant);
        }

        if (state.assetsStatusClearTimer) {
            clearTimeout(state.assetsStatusClearTimer);
            state.assetsStatusClearTimer = null;
        }

        if (autoClear) {
            state.assetsStatusClearTimer = setTimeout(() => {
                state.assetsStatusClearTimer = null;
                setAssetsStatus(DEFAULT_ASSETS_STATUS);
            }, Math.max(1000, clearDelay));
        }

        state.onResize();
    }

    function getAssetsFolderHint() {
        switch (PLATFORM_KEY) {
            case 'windows': return '%AppData%\\.minecraft\\assets';
            case 'mac': return '~/Library/Application Support/minecraft/assets';
            case 'linux': return '~/.minecraft/assets';
            default: return '.minecraft/assets';
        }
    }

    function getObjectsFolderHint() {
        switch (PLATFORM_KEY) {
            case 'windows': return '%AppData%\\.minecraft\\assets\\objects';
            case 'mac': return '~/Library/Application Support/minecraft/assets/objects';
            case 'linux': return '~/.minecraft/assets/objects';
            default: return '.minecraft/assets/objects';
        }
    }

    function getIndexesFolderHint() {
        switch (PLATFORM_KEY) {
            case 'windows': return '%AppData%\\.minecraft\\assets\\indexes';
            case 'mac': return '~/Library/Application Support/minecraft/assets/indexes';
            case 'linux': return '~/.minecraft/assets/indexes';
            default: return '.minecraft/assets/indexes';
        }
    }

    function getHiddenFolderTip() {
        switch (PLATFORM_KEY) {
            case 'windows': return 'Enable "Show hidden items" in File Explorer if the folder is hidden.';
            case 'mac': return 'Press Command+Shift+. to reveal hidden folders such as Library.';
            case 'linux': return 'Enable viewing hidden files (Ctrl+H) if needed.';
            default: return null;
        }
    }

    function hasExpectedLocalLibrary() {
        return state.hasPersistedDiscLibrary
            || state.storageLibraryStatus === 'present'
            || state.backgroundLibraryStatus === 'present'
            || state.discHashIndex.size > 0;
    }

    function updateDiscAvailabilityIndicators() {
        const expectLocalLibrary = hasExpectedLocalLibrary();
        getDiscElements().forEach(disc => {
            const discId = disc.getAttribute('data-disc-id');
            const shouldDisable = !state.isDiscLibraryReady
                && !expectLocalLibrary
                && !catalog.canDiscStreamWithoutLibrary(discId);
            disc.classList.toggle('disabled', shouldDisable);
            if (shouldDisable) {
                disc.setAttribute('aria-disabled', 'true');
            } else {
                disc.removeAttribute('aria-disabled');
            }
        });
    }

    function updateSelectAssetsButtonVisibility() {
        if (!state.dom?.selectAssetsBtn && !state.dom?.assetsInfoBtn) return;

        const hasReadyLocalAudio = (state.isDiscLibraryReady && state.discHashIndex.size > 0)
            || state.hasPersistedDiscLibrary;
        const shouldHide = state.assetsControlsLocked || hasReadyLocalAudio;

        if (state.dom.selectAssetsBtn) {
            state.dom.selectAssetsBtn.hidden = shouldHide;
        }
        if (state.dom.assetsInfoBtn) {
            state.dom.assetsInfoBtn.hidden = shouldHide;
        }

        if (state.dom.discPanelActions) {
            const hasVisibleButton = (state.dom.selectAssetsBtn && !state.dom.selectAssetsBtn.hidden)
                || (state.dom.assetsInfoBtn && !state.dom.assetsInfoBtn.hidden);
            state.dom.discPanelActions.classList.toggle('no-assets-buttons', !hasVisibleButton);
        }

        state.onResize();
    }

    function refreshAssetsControlsLock() {
        const hasReadyLocalAudio = state.isDiscLibraryReady && state.discHashIndex.size > 0;
        const backgroundHasLibrary = state.backgroundLibraryStatus === 'present';

        if (hasReadyLocalAudio || backgroundHasLibrary) {
            state.hasPersistedDiscLibrary = true;
            state.assetsControlsLocked = false;
            updateSelectAssetsButtonVisibility();
            updateDiscAvailabilityIndicators();
            return;
        }

        state.hasPersistedDiscLibrary = false;
        state.assetsControlsLocked = state.storageLibraryStatus === 'unknown' || state.backgroundLibraryStatus === 'unknown';

        updateSelectAssetsButtonVisibility();
        updateDiscAvailabilityIndicators();
    }

    function releaseDiscObjectUrls() {
        const uniqueUrls = new Set(state.discObjectUrlRegistry.values());
        for (const url of uniqueUrls) {
            try {
                URL.revokeObjectURL(url);
            } catch (error) {
                /* ignore revocation issues */
            }
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

        updateDiscAvailabilityIndicators();
        refreshAssetsControlsLock();
        if (state.isDiscLibraryReady && (!state.dom?.assetsStatusLabel || state.dom.assetsStatusLabel.textContent === DEFAULT_ASSETS_STATUS)) {
            setAssetsStatus(DEFAULT_ASSETS_STATUS);
        }
        state.onLibraryReady(state.isDiscLibraryReady);
    }

    function resetDiscLibraryState() {
        releaseDiscObjectUrls();
        state.discHashIndex = new Map();
        state.minecraftAssetsHandles = null;
        state.hasPersistedDiscLibrary = false;
        state.storageLibraryStatus = 'absent';
        state.backgroundLibraryStatus = 'absent';
        markDiscLibraryReady(false);
        setAssetsStatus(DEFAULT_ASSETS_STATUS);
    }

    function showDiscLibraryMissingWarning() {
        setAssetsStatus(withHint('Local Minecraft discs not found. Choose your Minecraft assets folder again.', getAssetsFolderHint()), 'warning');
    }

    function isSystemFolderError(error) {
        if (!error) return false;
        if (error?.name === 'SecurityError') return true;
        const message = String(error?.message || '').toLowerCase();
        return message.includes('system file') || message.includes('system files');
    }

    function normalizeRelativePath(path) {
        if (!path) return '';
        const cleaned = String(path).replace(/^[.\\/]+/, '').replace(/\\/g, '/');
        const segments = cleaned.split('/').filter(Boolean);
        if (!segments.length) return '';
        const lowerSegments = segments.map(segment => segment.toLowerCase());
        const targetIndex = lowerSegments.findIndex(segment => segment === 'indexes' || segment === 'objects');
        return targetIndex > 0 ? segments.slice(targetIndex).join('/') : segments.join('/');
    }

    function waitForDirectoryUploadSelection(input) {
        return new Promise((resolve, reject) => {
            if (!input) {
                reject(new Error('Folder uploads are not supported in this browser.'));
                return;
            }

            const handleChange = () => {
                input.removeEventListener('change', handleChange);
                input.removeEventListener('cancel', handleCancel);
                const files = input.files ? Array.from(input.files) : [];
                input.value = '';
                resolve(files);
            };

            const handleCancel = () => {
                input.removeEventListener('cancel', handleCancel);
                input.removeEventListener('change', handleChange);
                input.value = '';
                reject(new DOMException('Selection cancelled.', 'AbortError'));
            };

            input.addEventListener('change', handleChange, { once: true });
            input.addEventListener('cancel', handleCancel, { once: true });
            try {
                input.click();
            } catch (error) {
                input.removeEventListener('change', handleChange);
                input.removeEventListener('cancel', handleCancel);
                reject(error);
            }
        });
    }

    function pickLatestIndexFile(files = []) {
        let latest = null;
        for (const file of files) {
            if (!(file instanceof File)) continue;
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

    function collectObjectFiles(files = []) {
        const objectFiles = new Map();
        for (const file of files) {
            if (!(file instanceof File)) continue;
            const path = normalizeRelativePath(file.webkitRelativePath || file.name);
            if (path.startsWith('objects/')) {
                objectFiles.set(path, file);
            }
        }
        return objectFiles;
    }

    async function ensureReadPermission(handle) {
        if (!handle?.queryPermission) return true;
        try {
            const current = await handle.queryPermission({ mode: 'read' });
            if (current === 'granted') return true;
            if (!handle.requestPermission) return false;
            const requested = await handle.requestPermission({ mode: 'read' }).catch(() => current);
            return requested === 'granted';
        } catch (error) {
            return false;
        }
    }

    async function findLatestIndexFile(indexesHandle) {
        let latest = null;
        for await (const entry of indexesHandle.values()) {
            if (entry?.kind !== 'file' || !entry.name.endsWith('.json')) continue;
            try {
                const file = await entry.getFile();
                if (!file) continue;
                if (!latest
                    || file.lastModified > latest.file.lastModified
                    || (file.lastModified === latest.file.lastModified && entry.name > latest.handle.name)) {
                    latest = { handle: entry, file };
                }
            } catch (error) {
                /* ignore unreadable entries */
            }
        }
        return latest;
    }

    async function getHashedFile(objectsHandle, hash) {
        const prefix = hash.slice(0, 2);
        let bucketHandle;
        try {
            bucketHandle = await objectsHandle.getDirectoryHandle(prefix);
        } catch (error) {
            throw new Error(`Missing objects shard for hash prefix "${prefix}".`);
        }

        try {
            const fileHandle = await bucketHandle.getFileHandle(hash);
            return await fileHandle.getFile();
        } catch (error) {
            throw new Error(`Missing hashed object ${hash}.`);
        }
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
            const hash = meta?.hash;
            if (typeof hash !== 'string' || hash.length < 6) continue;
            discs.push({ assetKey: match[1], hash });
        }

        if (!discs.length) {
            throw new Error('No music discs were found in the selected assets index.');
        }

        return discs;
    }

    async function buildDiscLibrary(rootHandle) {
        if (!rootHandle) throw new Error('No folder was selected.');

        let assetsRootHandle = rootHandle;

        async function tryResolve(handle) {
            try {
                return {
                    indexes: await handle.getDirectoryHandle('indexes'),
                    objects: await handle.getDirectoryHandle('objects')
                };
            } catch (error) {
                return null;
            }
        }

        let resolved = await tryResolve(assetsRootHandle);
        if (!resolved) {
            try {
                const nestedAssetsHandle = await rootHandle.getDirectoryHandle('assets');
                resolved = await tryResolve(nestedAssetsHandle);
                if (resolved) {
                    assetsRootHandle = nestedAssetsHandle;
                }
            } catch (error) {
                /* ignore */
            }
        }

        if (!resolved) {
            throw new Error('Selected folder does not contain the Minecraft assets directories.');
        }

        const hasRootPermission = await ensureReadPermission(assetsRootHandle);
        const hasIndexPermission = await ensureReadPermission(resolved.indexes);
        const hasObjectsPermission = await ensureReadPermission(resolved.objects);
        if (!hasRootPermission || !hasIndexPermission || !hasObjectsPermission) {
            throw new Error('Read access to the selected folder was not granted.');
        }

        const latestIndex = await findLatestIndexFile(resolved.indexes);
        if (!latestIndex) {
            throw new Error('No index JSON files were found inside the /indexes directory.');
        }

        let parsed;
        try {
            parsed = JSON.parse(await latestIndex.file.text());
        } catch (error) {
            throw new Error('Failed to parse the latest assets index JSON.');
        }

        return {
            discs: extractDiscEntriesFromIndex(parsed),
            rootHandle: assetsRootHandle,
            objectsHandle: resolved.objects,
            latestIndexName: latestIndex.handle?.name ?? 'latest'
        };
    }

    function runtimeSendMessage(payload) {
        return new Promise(resolve => {
            if (!chrome?.runtime?.sendMessage) {
                resolve({ ok: false, response: null });
                return;
            }
            try {
                chrome.runtime.sendMessage(payload, response => {
                    if (chrome.runtime.lastError) {
                        console.warn('Failed to send message to background:', chrome.runtime.lastError.message);
                        resolve({ ok: false, response: null });
                        return;
                    }
                    resolve({ ok: true, response });
                });
            } catch (error) {
                console.warn('Failed to send message to background:', error);
                resolve({ ok: false, response: null });
            }
        });
    }

    function sendAssetsSelectionToBackground({ rootHandle, objectsHandle, discIndex, latestIndexName }) {
        if (!chrome?.runtime?.sendMessage) return;
        const maybePromise = chrome.runtime.sendMessage({
            type: 'minecraftAssetsSelected',
            assets: {
                rootDirectory: rootHandle,
                objectsDirectory: objectsHandle,
                discIndex: Array.from(discIndex.entries()),
                latestIndexName
            }
        });
        if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => {});
        }
    }

    async function sendBlobFile(key, file) {
        const base64Data = await shared.blobToBase64(file);
        if (!base64Data) return false;
        const { ok } = await runtimeSendMessage({
            type: 'minecraftAssetBlob',
            key: String(key),
            base64Data,
            mimeType: file?.type || 'audio/ogg'
        });
        return ok;
    }

    async function sendUploadedAssetsToBackground({ discIndex, latestIndexName, blobEntries }) {
        const indexMessage = await runtimeSendMessage({
            type: 'minecraftAssetsUploadedIndex',
            assets: {
                discIndex: Array.from(discIndex.entries()),
                latestIndexName
            }
        });

        if (!indexMessage.ok) {
            setAssetsStatus('Failed to cache discs. Please try again.', 'error');
            return false;
        }

        const uploadedKeys = new Set();
        for (const [key, file] of blobEntries) {
            const success = await sendBlobFile(key, file);
            if (!success) {
                setAssetsStatus('Failed to cache discs. Please try again.', 'error');
                await runtimeSendMessage({ type: 'minecraftAssetsUploadComplete', keys: Array.from(uploadedKeys) });
                return false;
            }
            uploadedKeys.add(String(key));
        }

        await runtimeSendMessage({ type: 'minecraftAssetsUploadComplete', keys: Array.from(uploadedKeys) });
        return true;
    }

    async function buildDiscLibraryFromFiles({ discs, objectFileMap, latestIndexName }, { persistToBackground = true } = {}) {
        const newHashIndex = new Map();
        const newObjectUrls = new Map();
        const blobEntryMap = new Map();
        const failures = [];
        const resolvedDiscKeys = new Set();

        for (const disc of discs) {
            const { assetKey, hash } = disc;
            if (!assetKey || typeof hash !== 'string') continue;
            const relativePath = `objects/${hash.slice(0, 2)}/${hash}`;
            const file = objectFileMap.get(relativePath);
            if (!file) {
                failures.push({ disc, reason: 'missingFile' });
                continue;
            }

            try {
                newHashIndex.set(assetKey, hash);
                newObjectUrls.set(assetKey, URL.createObjectURL(file));
                blobEntryMap.set(assetKey, file);
                resolvedDiscKeys.add(assetKey);
            } catch (error) {
                failures.push({ disc, reason: 'urlCreation', error });
            }
        }

        if (!newObjectUrls.size) {
            throw new Error('Unable to resolve any music discs from the selected assets.');
        }

        releaseDiscObjectUrls();
        state.discHashIndex = newHashIndex;
        state.discObjectUrlRegistry = newObjectUrls;
        state.minecraftAssetsHandles = null;
        markDiscLibraryReady(true);

        let persisted = !persistToBackground;
        if (persistToBackground) {
            persisted = await sendUploadedAssetsToBackground({
                discIndex: newHashIndex,
                latestIndexName,
                blobEntries: Array.from(blobEntryMap.entries())
            });
        }

        return {
            loadedCount: resolvedDiscKeys.size,
            failures,
            persisted
        };
    }

    async function buildRuntimeDiscLibrary({ rootHandle = null, objectsHandle, discs, latestIndexName }) {
        if (!objectsHandle) throw new Error('Missing objects directory handle.');

        const hasObjectsPermission = await ensureReadPermission(objectsHandle);
        if (!hasObjectsPermission) {
            throw new Error('Read access to the objects directory was not granted.');
        }

        const newHashIndex = new Map();
        const newObjectUrls = new Map();
        const failures = [];
        const resolvedDiscKeys = new Set();

        for (const disc of discs) {
            try {
                const file = await getHashedFile(objectsHandle, disc.hash);
                newHashIndex.set(disc.assetKey, disc.hash);
                newObjectUrls.set(disc.assetKey, URL.createObjectURL(file));
                resolvedDiscKeys.add(disc.assetKey);
            } catch (error) {
                failures.push({ disc, error });
            }
        }

        if (!newObjectUrls.size) {
            for (const url of newObjectUrls.values()) {
                try {
                    URL.revokeObjectURL(url);
                } catch (error) {
                    /* ignore */
                }
            }
            throw new Error('Unable to resolve any music discs from the selected assets.');
        }

        releaseDiscObjectUrls();
        state.discHashIndex = newHashIndex;
        state.discObjectUrlRegistry = newObjectUrls;
        state.minecraftAssetsHandles = { root: rootHandle, objects: objectsHandle };
        markDiscLibraryReady(true);

        sendAssetsSelectionToBackground({
            rootHandle,
            objectsHandle,
            discIndex: newHashIndex,
            latestIndexName
        });

        return {
            loadedCount: resolvedDiscKeys.size,
            failures
        };
    }

    function hasDiscLibrary() {
        return state.discHashIndex.size > 0;
    }

    function resolveDiscEntry(discId, { allowStreaming = true } = {}) {
        const desiredKey = shared.toAssetKey(discId);
        if (!desiredKey) return null;

        if (state.discObjectUrlRegistry.has(desiredKey)) {
            return {
                assetKey: desiredKey,
                objectUrl: state.discObjectUrlRegistry.get(desiredKey),
                hash: state.discHashIndex.get(desiredKey) || null
            };
        }

        for (const key of state.discHashIndex.keys()) {
            if (shared.toAssetKey(key) === desiredKey) {
                return {
                    assetKey: key,
                    objectUrl: state.discObjectUrlRegistry.get(key) || null,
                    hash: state.discHashIndex.get(key) || null
                };
            }
        }

        if (!allowStreaming) return null;
        const streamingSources = catalog.getStreamingSources(desiredKey);
        if (!streamingSources.length) return null;
        const [primary, ...fallbacks] = streamingSources;
        return {
            assetKey: desiredKey,
            objectUrl: primary,
            streamFallbacks: fallbacks,
            isStream: true
        };
    }

    async function loadMinecraftAssetsFromHandle(rootHandle) {
        const library = await buildDiscLibrary(rootHandle);
        const { loadedCount, failures } = await buildRuntimeDiscLibrary({
            rootHandle: library.rootHandle,
            objectsHandle: library.objectsHandle,
            discs: library.discs,
            latestIndexName: library.latestIndexName
        });

        if (failures.length) {
            setAssetsStatus(loadedCount > 0 ? 'Loaded discs, but some tracks are missing.' : 'Couldn’t load those discs. Please try again.', 'warning');
        } else {
            setAssetsStatus('Your discs are ready.', 'success', { autoClear: true, clearDelay: 4000 });
        }
    }

    async function handleRestrictedAssetsSelection() {
        if (typeof window.showDirectoryPicker !== 'function' || typeof window.showOpenFilePicker !== 'function') {
            throw new Error('Your browser does not support the required file pickers.');
        }

        let combinedMessage = withHint('Select your Minecraft assets / objects folder so we can load the discs.', getObjectsFolderHint());
        const hiddenTip = getHiddenFolderTip();
        if (hiddenTip) {
            combinedMessage = `${combinedMessage} ${hiddenTip}`;
        }
        setAssetsStatus(combinedMessage, 'warning');

        const objectsHandle = await window.showDirectoryPicker({ id: 'minecraft-assets-objects', mode: 'read' });
        if (!objectsHandle) {
            throw new DOMException('Selection cancelled.', 'AbortError');
        }

        const hasObjectsPermission = await ensureReadPermission(objectsHandle);
        if (!hasObjectsPermission) {
            throw new Error('Read access to the objects directory was not granted.');
        }

        setAssetsStatus(withHint('Select the latest JSON inside the indexes folder.', getIndexesFolderHint()), 'warning');

        const pickerResult = await window.showOpenFilePicker({
            id: 'minecraft-assets-index',
            multiple: false,
            excludeAcceptAllOption: false,
            types: [{
                description: 'Minecraft asset index',
                accept: { 'application/json': ['.json'] }
            }]
        });

        if (!pickerResult?.length) {
            throw new DOMException('Selection cancelled.', 'AbortError');
        }

        const indexFileHandle = pickerResult[0];
        const hasIndexPermission = await ensureReadPermission(indexFileHandle);
        if (!hasIndexPermission) {
            throw new Error('Read access to the selected assets index was not granted.');
        }

        const indexFile = await indexFileHandle.getFile();
        if (!indexFile) {
            throw new Error('Unable to read the selected assets index file.');
        }

        let parsed;
        try {
            parsed = JSON.parse(await indexFile.text());
        } catch (error) {
            throw new Error('Failed to parse the selected assets index JSON.');
        }

        const { loadedCount, failures } = await buildRuntimeDiscLibrary({
            rootHandle: null,
            objectsHandle,
            discs: extractDiscEntriesFromIndex(parsed),
            latestIndexName: indexFileHandle.name
        });

        if (failures.length) {
            setAssetsStatus(loadedCount > 0 ? 'Loaded discs, but some tracks are missing.' : 'Couldn’t load those discs. Please try again.', 'warning');
        } else {
            setAssetsStatus('Your discs are ready.', 'success', { autoClear: true, clearDelay: 4000 });
        }
    }

    async function handleFileUploadAssetsSelection({ force = false } = {}) {
        if (state.isLoadingAssets && !force) return false;

        state.isLoadingAssets = true;
        if (state.dom?.selectAssetsBtn) {
            state.dom.selectAssetsBtn.disabled = true;
        }
        markDiscLibraryReady(false);

        let loadSucceeded = false;
        try {
            let statusMessage = withHint('Choose your Minecraft assets folder to unlock every classic disc.', getAssetsFolderHint());
            const hiddenTip = getHiddenFolderTip();
            if (hiddenTip) {
                statusMessage = `${statusMessage} ${hiddenTip}`;
            }
            setAssetsStatus(statusMessage, 'warning');

            const files = await waitForDirectoryUploadSelection(state.dom?.assetsDirectoryInput);
            if (!files.length) {
                setAssetsStatus('Selection cancelled.', 'warning');
                return false;
            }

            setAssetsStatus('Preparing discs…', 'warning');
            const latestIndex = pickLatestIndexFile(files);
            if (!latestIndex) {
                setAssetsStatus('No assets index JSON files were found in the selected folder.', 'error');
                return false;
            }

            let parsed;
            try {
                parsed = JSON.parse(await latestIndex.file.text());
            } catch (error) {
                setAssetsStatus('Failed to parse the selected assets index JSON.', 'error');
                return false;
            }

            setAssetsStatus('Saving discs…', 'warning');
            const results = await buildDiscLibraryFromFiles({
                discs: extractDiscEntriesFromIndex(parsed),
                objectFileMap: collectObjectFiles(files),
                latestIndexName: latestIndex.file.name
            });

            if (results.failures.length) {
                setAssetsStatus(results.loadedCount > 0 ? 'Loaded discs, but some tracks are missing.' : 'Couldn’t load those discs. Please try again.', 'warning');
            } else if (results.persisted) {
                setAssetsStatus('Disc upload successful.', 'success', { autoClear: true, clearDelay: 6000 });
            } else {
                setAssetsStatus('Discs ready now, but upload again to save them.', 'warning');
            }

            loadSucceeded = true;
        } catch (error) {
            if (error?.name === 'AbortError') {
                setAssetsStatus('No folder was picked. Try again when you’re ready.', 'warning');
            } else {
                console.error('Failed to upload assets directory', error);
                setAssetsStatus(error?.message || 'Failed to upload assets directory.', 'error');
            }
        } finally {
            state.isLoadingAssets = false;
            if (state.dom?.selectAssetsBtn) {
                state.dom.selectAssetsBtn.disabled = false;
            }
        }

        return loadSucceeded;
    }

    async function handleAssetsSelection() {
        if (state.isLoadingAssets) return;
        if (PLATFORM_KEY === 'mac' || PLATFORM_KEY === 'windows') {
            await handleFileUploadAssetsSelection();
            return;
        }
        if (typeof window.showDirectoryPicker !== 'function') {
            await handleFileUploadAssetsSelection();
            return;
        }

        const hadExistingLibrary = hasDiscLibrary();
        state.isLoadingAssets = true;
        if (state.dom?.selectAssetsBtn) {
            state.dom.selectAssetsBtn.disabled = true;
        }
        markDiscLibraryReady(false);

        try {
            let waitingMessage = withHint('Choose your Minecraft assets folder so we can find every record.', getAssetsFolderHint());
            const waitingTip = getHiddenFolderTip();
            if (waitingTip) {
                waitingMessage = `${waitingMessage} ${waitingTip}`;
            }
            setAssetsStatus(waitingMessage, 'warning');

            const directoryHandle = await window.showDirectoryPicker({ id: 'minecraft-assets-root', mode: 'read' });
            if (!directoryHandle) {
                setAssetsStatus('No folder was picked. Try again when you’re ready.', 'warning');
                return;
            }

            await loadMinecraftAssetsFromHandle(directoryHandle);
        } catch (error) {
            let handledByFallback = false;
            let userCancelledFallback = false;

            if (error?.name === 'AbortError') {
                setAssetsStatus('No folder was picked. Try again when you’re ready.', 'warning');
            } else if (isSystemFolderError(error)) {
                try {
                    await handleRestrictedAssetsSelection();
                    handledByFallback = true;
                } catch (fallbackError) {
                    if (fallbackError?.name === 'AbortError') {
                        setAssetsStatus('No folder was picked. Try again when you’re ready.', 'warning');
                        userCancelledFallback = true;
                    } else {
                        setAssetsStatus(fallbackError?.message || 'Failed to load Minecraft assets.', 'error');
                    }
                }

                if (!handledByFallback && !userCancelledFallback) {
                    handledByFallback = await handleFileUploadAssetsSelection({ force: true });
                }
            } else {
                setAssetsStatus(error?.message || 'Failed to load Minecraft assets.', 'error');
            }

            if (!handledByFallback && !hadExistingLibrary) {
                resetDiscLibraryState();
            }
        } finally {
            state.isLoadingAssets = false;
            if (state.dom?.selectAssetsBtn) {
                state.dom.selectAssetsBtn.disabled = false;
            }
        }
    }

    function requestDiscBlob(key) {
        return new Promise(resolve => {
            if (!chrome?.runtime?.sendMessage) {
                resolve(null);
                return;
            }

            chrome.runtime.sendMessage({ type: 'requestDiscBlob', key }, response => {
                if (chrome.runtime.lastError) {
                    resolve(null);
                    return;
                }

                if (response?.base64Data) {
                    try {
                        const blob = shared.base64ToBlob(response.base64Data, response.mimeType || 'audio/ogg');
                        resolve(blob ? { blob, hash: response.hash, key: response.key } : null);
                    } catch (error) {
                        resolve(null);
                    }
                } else {
                    resolve(response || null);
                }
            });
        });
    }

    async function hydrateDiscLibraryFromBackground(assets = {}) {
        if (state.discObjectUrlRegistry.size > 0 || state.isLoadingAssets) return false;

        const {
            objectsDirectory = null,
            discIndex = [],
            latestIndexName,
            hasBlobLibrary = false
        } = assets;

        if (!Array.isArray(discIndex) || !discIndex.length) return false;

        state.isLoadingAssets = true;
        try {
            const discs = [];
            const seenKeys = new Set();
            for (const entry of discIndex) {
                if (!Array.isArray(entry) || entry.length < 2) continue;
                const key = typeof entry[0] === 'string' ? entry[0] : String(entry[0] ?? '');
                const hash = typeof entry[1] === 'string' ? entry[1] : null;
                if (!key || !hash || hash.length < 6) continue;

                const dedupeKey = shared.toAssetKey(key) || key;
                if (seenKeys.has(dedupeKey)) continue;
                seenKeys.add(dedupeKey);
                discs.push({ assetKey: key, hash });
            }

            if (!discs.length) return false;

            if (objectsDirectory) {
                const hasPermission = await ensureReadPermission(objectsDirectory);
                if (hasPermission) {
                    try {
                        const { loadedCount, failures } = await buildRuntimeDiscLibrary({
                            rootHandle: null,
                            objectsHandle: objectsDirectory,
                            discs,
                            latestIndexName: latestIndexName || 'cached'
                        });

                        const relevantFailures = failures.filter(item => {
                            const assetKey = item?.disc?.assetKey;
                            return assetKey ? !catalog.hasStreamingSource(assetKey) : true;
                        });

                        if (relevantFailures.length) {
                            setAssetsStatus(loadedCount > 0 ? 'Loaded discs, but some tracks are missing.' : 'Couldn’t load those discs. Please try again.', 'warning');
                        } else {
                            setAssetsStatus(DEFAULT_ASSETS_STATUS);
                        }

                        return true;
                    } catch (error) {
                        console.error('Failed to hydrate disc library from cached assets', error);
                    }
                }
            }

            if (!hasBlobLibrary) {
                setAssetsStatus(DEFAULT_ASSETS_STATUS);
                return false;
            }

            const objectFileMap = new Map();
            const missingKeys = [];
            for (const disc of discs) {
                const response = await requestDiscBlob(disc.assetKey);
                if (!response?.blob || !(response.blob instanceof Blob)) {
                    missingKeys.push(disc.assetKey);
                    continue;
                }

                const effectiveHash = typeof response.hash === 'string' && response.hash.length >= 6 ? response.hash : disc.hash;
                const finalPath = `objects/${effectiveHash.slice(0, 2)}/${effectiveHash}`;
                try {
                    const file = new File([response.blob], effectiveHash, { type: 'audio/ogg' });
                    objectFileMap.set(finalPath, file);
                } catch (error) {
                    missingKeys.push(disc.assetKey);
                }
            }

            if (!objectFileMap.size) {
                const relevantMissing = missingKeys.filter(assetKey => !catalog.hasStreamingSource(assetKey));
                if (relevantMissing.length) {
                    setAssetsStatus('Couldn’t restore some saved discs.', 'warning');
                } else {
                    setAssetsStatus(DEFAULT_ASSETS_STATUS);
                }
                markDiscLibraryReady(false);
                return false;
            }

            const { loadedCount, failures } = await buildDiscLibraryFromFiles({
                discs,
                objectFileMap,
                latestIndexName: latestIndexName || 'cached'
            }, { persistToBackground: false });

            const relevantFailures = failures.filter(item => {
                const assetKey = item?.disc?.assetKey;
                return assetKey ? !catalog.hasStreamingSource(assetKey) : true;
            });
            const relevantMissing = missingKeys.filter(assetKey => !catalog.hasStreamingSource(assetKey));
            if (relevantFailures.length || relevantMissing.length) {
                setAssetsStatus(loadedCount > 0 ? 'Loaded discs, but some tracks are missing.' : 'Couldn’t load those discs. Please try again.', 'warning');
            } else {
                setAssetsStatus(DEFAULT_ASSETS_STATUS);
                markDiscLibraryReady(true);
            }

            return true;
        } catch (error) {
            console.error('Failed to rebuild disc library from cached blobs', error);
            markDiscLibraryReady(false);
            return false;
        } finally {
            state.isLoadingAssets = false;
        }
    }

    function requestAssetsFromBackground() {
        if (state.discObjectUrlRegistry.size > 0 || state.isLoadingAssets || !chrome?.runtime?.sendMessage) return;

        chrome.runtime.sendMessage({ type: 'requestMinecraftAssets' }, response => {
            const hadPersistedLibrary = state.hasPersistedDiscLibrary
                || state.storageLibraryStatus === 'present'
                || state.backgroundLibraryStatus === 'present';

            if (chrome.runtime.lastError) {
                state.backgroundLibraryStatus = 'absent';
                refreshAssetsControlsLock();
                return;
            }

            if (response?.assets) {
                const nextAssets = response.assets;
                if (Array.isArray(nextAssets.discIndex) && nextAssets.discIndex.length > 0) {
                    state.hasPersistedDiscLibrary = true;
                    state.backgroundLibraryStatus = 'present';
                } else if (nextAssets.hasBlobLibrary) {
                    state.backgroundLibraryStatus = 'present';
                } else {
                    state.backgroundLibraryStatus = 'absent';
                    resetDiscLibraryState();
                    if (hadPersistedLibrary) {
                        showDiscLibraryMissingWarning();
                    }
                }

                refreshAssetsControlsLock();
                hydrateDiscLibraryFromBackground(nextAssets).catch(() => {});
            } else {
                state.backgroundLibraryStatus = 'absent';
                resetDiscLibraryState();
                if (hadPersistedLibrary) {
                    showDiscLibraryMissingWarning();
                }
                refreshAssetsControlsLock();
            }
        });
    }

    function openDiscHelpPage() {
        const helpUrl = chrome.runtime ? chrome.runtime.getURL('disc-help.html') : 'disc-help.html';
        window.open(helpUrl, '_blank', 'noopener,noreferrer');
    }

    function handleRuntimeMessage(message) {
        if (message.type === 'minecraftAssetsStatus' && typeof message.message === 'string') {
            const variant = message.level === 'success' ? 'success' : message.level === 'warning' ? 'warning' : 'error';
            setAssetsStatus(message.message, variant);
            return;
        }

        if (message.type === 'minecraftDiscCacheCleared') {
            const hadPersistedLibrary = state.hasPersistedDiscLibrary
                || state.storageLibraryStatus === 'present'
                || state.backgroundLibraryStatus === 'present';
            resetDiscLibraryState();
            if (hadPersistedLibrary) {
                showDiscLibraryMissingWarning();
            }
        }
    }

    function initialize({ dom, onResize, onLibraryReady }) {
        state.dom = dom;
        state.onResize = typeof onResize === 'function' ? onResize : () => {};
        state.onLibraryReady = typeof onLibraryReady === 'function' ? onLibraryReady : () => {};

        setAssetsStatus(DEFAULT_ASSETS_STATUS);
        updateDiscAvailabilityIndicators();
        refreshAssetsControlsLock();

        state.dom?.selectAssetsBtn?.addEventListener('click', () => {
            handleAssetsSelection().catch(() => {});
        });

        if (chrome?.storage?.local?.get) {
            chrome.storage.local.get(['minecraftDiscIndex'], data => {
                const storedIndex = data?.minecraftDiscIndex;
                if (storedIndex && Array.isArray(storedIndex.discIndex) && storedIndex.discIndex.length > 0) {
                    state.hasPersistedDiscLibrary = true;
                    state.storageLibraryStatus = 'present';
                } else {
                    state.storageLibraryStatus = 'absent';
                }
                refreshAssetsControlsLock();
            });
        } else {
            state.storageLibraryStatus = 'absent';
            refreshAssetsControlsLock();
        }
    }

    globalThis.MinecraftJukeboxAssets = {
        initialize,
        setAssetsStatus,
        withAssetsHint: baseMessage => withHint(baseMessage, getAssetsFolderHint()),
        getAssetsFolderHint,
        hasExpectedLocalLibrary,
        isReady: () => state.isDiscLibraryReady,
        hasDiscLibrary,
        resolveDiscEntry,
        requestAssetsFromBackground,
        openDiscHelpPage,
        handleRuntimeMessage
    };
})();
