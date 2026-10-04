(() => {
    const PLAYER_URL = chrome.runtime.getURL('src/popup/popup.html?window=1');
    const WINDOW_ID_KEY = 'playerWindowId';
    const BOUNDS_KEY = 'playerWindowBounds';
    let playerWindowId = null;
    let openingWindow = null;

    // Session storage survives worker suspension, but never reuses an ID from
    // an earlier browser session. The URL lookup also handles restored windows.
    const windowIdReady = chrome.storage.session.get(WINDOW_ID_KEY).then(stored => {
        if (Number.isInteger(stored[WINDOW_ID_KEY])) {
            playerWindowId = stored[WINDOW_ID_KEY];
        }
    }).catch(() => {});

    function getBounds(window) {
        return Object.fromEntries(['width', 'height', 'left', 'top']
            .filter(key => Number.isFinite(window[key]))
            .map(key => [key, Math.round(window[key])]));
    }

    function getOpeningBounds(saved, screen) {
        const bounds = saved && typeof saved === 'object' ? getBounds(saved) : {};
        const display = screen && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(screen[key]))
            && screen.width > 0 && screen.height > 0 ? getBounds(screen) : null;

        // Fit the invoking display when a monitor was disconnected or changed.
        // The popup supplies Screen.avail* so no display permission is needed.
        const maxWidth = Math.min(display?.width || 16384, 16384);
        const maxHeight = Math.min(display?.height || 16384, 16384);
        bounds.width = Math.min(maxWidth, Math.max(360, bounds.width || 520));
        bounds.height = Math.min(maxHeight, Math.max(420, bounds.height || 720));

        if (display) {
            bounds.left = Math.max(display.left, Math.min(
                bounds.left ?? display.left + Math.round((display.width - bounds.width) / 2),
                display.left + display.width - bounds.width
            ));
            bounds.top = Math.max(display.top, Math.min(
                bounds.top ?? display.top + Math.round((display.height - bounds.height) / 2),
                display.top + display.height - bounds.height
            ));
        }

        return bounds;
    }

    async function findPlayerWindow() {
        await windowIdReady;

        if (playerWindowId !== null) {
            try {
                const window = await chrome.windows.get(playerWindowId);
                if (window.type === 'popup') return window;
            } catch (_) {
                // The user may have closed the window while the worker slept.
            }
            playerWindowId = null;
        }

        // Window tab URLs require the tabs permission, even for our own page.
        // Extension contexts let us discover restored players without it.
        if (chrome.runtime.getContexts) {
            const contexts = await chrome.runtime.getContexts({ documentUrls: [PLAYER_URL] });
            for (const context of contexts) {
                try {
                    const window = await chrome.windows.get(context.windowId);
                    if (window.type === 'popup') return window;
                } catch (_) {
                    // This context may have closed since the query.
                }
            }
        }
        return null;
    }

    async function openPlayerWindow(screen) {
        let window = await findPlayerWindow();
        if (window) {
            try {
                window = await chrome.windows.update(window.id, {
                    focused: true,
                    ...(window.state === 'minimized' ? { state: 'normal' } : {})
                });
            } catch (_) {
                // Closing the window between lookup and focus is harmless.
                window = null;
            }
        }

        if (!window) {
            const stored = await chrome.storage.local.get(BOUNDS_KEY);
            window = await chrome.windows.create({
                url: PLAYER_URL,
                type: 'popup',
                focused: true,
                ...getOpeningBounds(stored[BOUNDS_KEY], screen)
            });
        }

        if (!Number.isInteger(window?.id)) {
            throw new Error('The player window could not be opened.');
        }

        playerWindowId = window.id;
        await chrome.storage.session.set({ [WINDOW_ID_KEY]: window.id });
        if (window.state === 'normal') {
            await chrome.storage.local.set({ [BOUNDS_KEY]: getBounds(window) });
        }
        return { ok: true, windowId: window.id };
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== 'openPlayerWindow') return false;

        // Coalesce clicks from multiple popup instances into one creation.
        if (!openingWindow) {
            openingWindow = openPlayerWindow(message.screen).finally(() => {
                openingWindow = null;
            });
        }
        openingWindow.then(sendResponse, error => {
            console.error('[MinecraftJukebox] Failed to open player window', error);
            sendResponse({ ok: false, error: 'The player window could not be opened. Please try again.' });
        });
        return true;
    });

    chrome.windows.onBoundsChanged.addListener(window => {
        windowIdReady.then(async () => {
            if (window.id === playerWindowId && window.state === 'normal') {
                await chrome.storage.local.set({ [BOUNDS_KEY]: getBounds(window) });
            }
        }).catch(error => {
            console.warn('[MinecraftJukebox] Failed to save player window size', error);
        });
    });

    chrome.windows.onRemoved.addListener(windowId => {
        windowIdReady.then(async () => {
            if (windowId === playerWindowId) {
                playerWindowId = null;
                await chrome.storage.session.remove(WINDOW_ID_KEY);
            }
        }).catch(() => {});
    });
})();
