const { test, expect } = require('@playwright/test');
const {
    closeExtension,
    getQueueTitles,
    launchExtension,
    openPopupPage,
    readStorage,
    waitForNowPlaying,
    waitForProgressToAdvance
} = require('./helpers/extension');

async function openPlayer(page, screen) {
    return page.evaluate(display => chrome.runtime.sendMessage({
        type: 'openPlayerWindow',
        screen: display
    }), screen);
}

async function getPlayerWindows(page) {
    // Each test owns a fresh browser profile; its only popup windows are players.
    return page.evaluate(() => chrome.windows.getAll({ windowTypes: ['popup'] }));
}

test.describe('Player window', () => {
    test('opens one window, focuses it, and reuses it after worker suspension', async () => {
        const extension = await launchExtension();
        try {
            const page = await openPopupPage(extension.context, extension.extensionId);
            const playerPagePromise = extension.context.waitForEvent('page');
            await page.locator('#popout-btn').click();
            const player = await playerPagePromise;
            await player.waitForLoadState();
            await expect(player.locator('body')).toHaveClass(/player-window/);
            await expect(player.locator('#popout-btn')).toBeHidden();

            const first = (await getPlayerWindows(page))[0];
            expect(first).toBeTruthy();
            await page.evaluate(windowId => chrome.windows.update(windowId, { state: 'minimized' }), first.id);

            const responses = await page.evaluate(() => Promise.all(Array.from({ length: 4 }, () =>
                chrome.runtime.sendMessage({ type: 'openPlayerWindow' })
            )));
            expect(responses).toEqual(Array(4).fill({ ok: true, windowId: first.id }));
            const focused = await getPlayerWindows(page);
            expect(focused).toHaveLength(1);
            expect(focused[0].state).toBe('normal');
            expect(focused[0].focused).toBe(true);

            const cdp = await extension.context.newCDPSession(page);
            await cdp.send('ServiceWorker.enable');
            await cdp.send('ServiceWorker.stopAllWorkers');
            expect(await openPlayer(page)).toEqual({ ok: true, windowId: first.id });

            // A restored window may lack a saved session ID. Find it by its own
            // extension URL without asking for access to users' browsing tabs.
            await page.evaluate(() => chrome.storage.session.remove('playerWindowId'));
            await cdp.send('ServiceWorker.stopAllWorkers');
            expect(await openPlayer(page)).toEqual({ ok: true, windowId: first.id });
            expect(await getPlayerWindows(page)).toHaveLength(1);
            await cdp.detach();
        } finally {
            await closeExtension(extension);
        }
    });

    test('remembers moved and resized bounds and recovers an unavailable display', async () => {
        const extension = await launchExtension({ viewport: null });
        try {
            const page = await openPopupPage(extension.context, extension.extensionId);
            const display = await page.evaluate(() => ({
                left: screen.availLeft, top: screen.availTop,
                width: screen.availWidth, height: screen.availHeight
            }));
            const first = await openPlayer(page);
            expect(first.ok).toBe(true);
            const requested = {
                width: Math.min(680, display.width - 40),
                height: Math.min(520, display.height - 40),
                left: display.left + 20, top: display.top + 20
            };
            const moved = await page.evaluate(({ windowId, bounds }) =>
                chrome.windows.update(windowId, bounds), { windowId: first.windowId, bounds: requested });
            const actual = Object.fromEntries(Object.keys(requested).map(key => [key, moved[key]]));
            await expect.poll(async () => (await readStorage(page, ['playerWindowBounds'])).playerWindowBounds)
                .toEqual(actual);

            await page.evaluate(windowId => chrome.windows.remove(windowId), first.windowId);
            await expect.poll(() => getPlayerWindows(page)).toHaveLength(0);
            const reopened = await openPlayer(page);
            expect(reopened.ok).toBe(true);
            expect(reopened.windowId).not.toBe(first.windowId);
            const restored = (await getPlayerWindows(page))[0];
            for (const key of Object.keys(actual)) expect(restored[key]).toBe(actual[key]);

            await page.evaluate(async windowId => {
                await chrome.windows.remove(windowId);
                await chrome.storage.local.set({ playerWindowBounds: {
                    width: 400, height: 480, left: 99999, top: 99999
                } });
                await chrome.storage.session.set({ playerWindowId: windowId });
            }, reopened.windowId);
            const cdp = await extension.context.newCDPSession(page);
            await cdp.send('ServiceWorker.enable');
            await cdp.send('ServiceWorker.stopAllWorkers');
            expect((await openPlayer(page, display)).ok).toBe(true);
            const recovered = (await getPlayerWindows(page))[0];
            expect(recovered.width).toBe(400);
            expect(recovered.height).toBe(480);
            expect(recovered.left).toBe(display.left + display.width - 400);
            expect(recovered.top).toBe(display.top + display.height - 480);
            await cdp.detach();
        } finally {
            await closeExtension(extension);
        }
    });

    test('shares playback and queue, and keeps music playing after the window closes', async () => {
        const extension = await launchExtension();
        try {
            const page = await openPopupPage(extension.context, extension.extensionId);
            await page.locator('#disc-menu-toggle').click();
            await page.locator('[data-disc-id="blocks"]').click();
            await waitForNowPlaying(page, 'blocks');
            await waitForProgressToAdvance(page);
            await page.locator('[data-disc-id="chirp"]').click({ button: 'right' });

            const playerPagePromise = extension.context.waitForEvent('page');
            const opened = await openPlayer(page);
            expect(opened.ok).toBe(true);
            const player = await playerPagePromise;
            await waitForNowPlaying(player, 'blocks');
            await expect.poll(() => getQueueTitles(player)).toEqual(['chirp']);
            await waitForProgressToAdvance(player);
            await player.locator('#skip-next-btn').click();
            await waitForNowPlaying(page, 'chirp');

            await player.close();
            await waitForProgressToAdvance(page, { minimumDelta: 1 });
            await expect.poll(() => getPlayerWindows(page)).toHaveLength(0);
            const stored = await readStorage(page, ['playbackState']);
            expect(stored.playbackState.currentTrack.discId).toBe('chirp');
        } finally {
            await closeExtension(extension);
        }
    });

    test('rapid cold-start selections finish on the last requested track', async () => {
        const extension = await launchExtension();
        try {
            const page = await openPopupPage(extension.context, extension.extensionId);
            await page.locator('#disc-menu-toggle').click();
            await page.evaluate(() => {
                window.lastPlayingDisc = null;
                chrome.runtime.onMessage.addListener(message => {
                    if (message.type === 'progress' && message.isPlaying && message.currentTime > 0) {
                        window.lastPlayingDisc = message.discId;
                    }
                });
                for (const id of ['blocks', 'chirp', 'ward']) {
                    document.querySelector(`[data-disc-id="${id}"]`).click();
                }
            });
            await waitForNowPlaying(page, 'ward');
            await waitForProgressToAdvance(page, { minimumDelta: 1 });
            await expect.poll(() => page.evaluate(() => window.lastPlayingDisc)).toBe('ward');
            const state = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'requestState' }));
            expect(state.currentTrack.discId).toBe('ward');
            expect(state.history.map(track => track.discId)).toEqual(['blocks', 'chirp']);
            const contexts = await page.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
            expect(contexts).toHaveLength(1);
        } finally {
            await closeExtension(extension);
        }
    });
});
