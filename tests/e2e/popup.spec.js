const { test, expect } = require('@playwright/test');
const {
    closeExtension,
    getProgressValue,
    getQueueTitles,
    launchExtension,
    openPopupPage,
    readStorage,
    setRangeValue,
    waitForNowPlaying,
    waitForProgressToAdvance,
    waitForQueueLength
} = require('./helpers/extension');

async function expandDiscMenu(page) {
    const toggle = page.locator('#disc-menu-toggle');
    const panel = page.locator('#disc-menu-panel');

    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.click();
    }

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
}

test.describe('Popup Playback', () => {
    test('jukebox starts playback and populates the queue', async () => {
        const { context, extensionId, userDataDir } = await launchExtension();

        try {
            const page = await openPopupPage(context, extensionId);

            await expect(page.locator('#now-playing')).toHaveText('Now Playing:');
            await page.locator('.hero-disc').click();

            await expect.poll(async () => {
                return page.locator('#now-playing').textContent();
            }).not.toBe('Now Playing:');

            await waitForQueueLength(page, 1);
            await waitForProgressToAdvance(page, { minimumDelta: 1 });
            await expect(page.locator('#duration-time')).toHaveText('1:30');

            const stored = await readStorage(page, ['playbackState']);
            expect(stored.playbackState.currentTrack).toBeTruthy();
            expect(stored.playbackState.queue.length).toBeGreaterThan(0);
        } finally {
            await closeExtension({ context, userDataDir });
        }
    });

    test('stream discs can be queued, skipped, reordered, and cleared', async () => {
        const { context, extensionId, userDataDir } = await launchExtension();

        try {
            const page = await openPopupPage(context, extensionId);
            await expandDiscMenu(page);

            await page.locator('[data-disc-id="blocks"]').click();
            await waitForNowPlaying(page, 'blocks');

            await page.locator('[data-disc-id="chirp"]').click({ button: 'right' });
            await page.locator('[data-disc-id="ward"]').click({ button: 'right' });
            await waitForQueueLength(page, 2);
            await expect.poll(() => getQueueTitles(page)).toEqual(['chirp', 'ward']);

            await page.locator('.queue-move-down[data-index="0"]').click();
            await expect.poll(() => getQueueTitles(page)).toEqual(['ward', 'chirp']);

            await page.locator('#skip-next-btn').click();
            await waitForNowPlaying(page, 'ward');

            await page.locator('#skip-prev-btn').click();
            await waitForNowPlaying(page, 'blocks');

            await page.locator('.queue-remove[data-index="0"]').click();
            await expect.poll(() => getQueueTitles(page)).toEqual(['chirp']);

            await page.locator('#clear-queue-btn').click();
            await expect(page.locator('.empty-queue')).toHaveText('Queue is empty');
        } finally {
            await closeExtension({ context, userDataDir });
        }
    });

    test('volume mute and seek controls update playback state', async () => {
        const { context, extensionId, userDataDir } = await launchExtension();

        try {
            const page = await openPopupPage(context, extensionId);
            await expandDiscMenu(page);
            await page.locator('[data-disc-id="blocks"]').click();

            await waitForNowPlaying(page, 'blocks');
            await waitForProgressToAdvance(page, { minimumDelta: 0.5 });
            await expect(page.locator('#duration-time')).toHaveText('1:30');

            await setRangeValue(page, '#volume-slider', 150);
            await expect.poll(async () => {
                const stored = await readStorage(page, ['volumeLevel']);
                return stored.volumeLevel;
            }).toBeCloseTo(1.5, 1);

            await page.locator('.volume-icon').click();
            await expect(page.locator('.volume-icon')).toHaveClass(/muted/);
            await expect.poll(async () => {
                const stored = await readStorage(page, ['volumeLevel']);
                return stored.volumeLevel;
            }).toBe(0);

            await page.locator('.volume-icon').click();
            await expect.poll(async () => {
                const stored = await readStorage(page, ['volumeLevel']);
                return stored.volumeLevel;
            }).toBeCloseTo(1.5, 1);

            const beforeForward = await getProgressValue(page);
            await page.locator('#forward-btn').click();
            await expect.poll(() => getProgressValue(page)).toBeGreaterThan(beforeForward + 8);

            await page.locator('#rewind-btn').click();
            await expect.poll(() => getProgressValue(page)).toBeLessThan(beforeForward + 4);
        } finally {
            await closeExtension({ context, userDataDir });
        }
    });

    test('a failed stream does not interrupt a song selected during error recovery', async () => {
        const launch = await launchExtension();
        launch.audioFixture.failSources.add('Blocks.mp3');
        try {
            const page = await openPopupPage(launch.context, launch.extensionId);
            await expandDiscMenu(page);
            await page.locator('[data-disc-id="blocks"]').click();
            await expect(page.locator('#assets-status')).toContainText('Streaming is unavailable');

            await page.locator('[data-disc-id="chirp"]').click();
            await waitForNowPlaying(page, 'chirp');
            await waitForProgressToAdvance(page, { minimumDelta: 1 });
            await expect(page.locator('#duration-time')).toHaveText('1:30');
            await expect(page.locator('#play-pause-btn')).toBeEnabled();
            const stored = await readStorage(page, ['playbackState']);
            expect(stored.playbackState.currentTrack?.discId).toBe('chirp');
            expect(launch.audioFixture.requests.some(request => request.failed)).toBe(true);
        } finally {
            await closeExtension(launch);
        }
    });
});
