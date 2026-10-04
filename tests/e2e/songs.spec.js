const { test, expect } = require('@playwright/test');
const {
    closeExtension,
    getProgressValue,
    getQueueTitles,
    launchExtension,
    openPopupPage,
    readStorage,
    waitForNowPlaying,
    waitForProgressToAdvance
} = require('./helpers/extension');

async function openSongs(page) {
    const search = page.locator('#song-search');
    if (!await search.isVisible()) {
        await page.locator('#songs-menu-toggle').click();
    }
    await expect(search).toBeVisible();
    return search;
}

test.describe('Other tracks', () => {
    test('searches titles, albums, and artists and recovers from no results', async () => {
        const launch = await launchExtension({ mockAudio: true });
        try {
            const page = await openPopupPage(launch.context, launch.extensionId);
            const search = await openSongs(page);
            const visibleRows = page.locator('.song-item:visible');

            await expect(visibleRows).toHaveCount(8);
            await expect(page.locator('#song-count')).toHaveText('58 tracks');
            await expect(page.locator('#song-page-range')).toHaveText('1–8 of 58');

            await search.fill('  SWEDEN  ');
            await expect(visibleRows).toHaveCount(1);
            await expect(visibleRows.locator('.song-title')).toHaveText('Sweden');
            await expect(page.locator('#song-count')).toHaveText('1 of 58 tracks');
            await expect(page.locator('#song-pagination')).toBeHidden();

            await search.fill('volume beta');
            await expect(visibleRows).toHaveCount(8);
            await expect(page.locator('#song-count')).toHaveText('30 of 58 tracks');
            await expect(page.locator('#song-page-range')).toHaveText('1–8 of 30');
            await expect(page.locator('#song-pagination')).toBeVisible();
            await search.fill('lena raine');
            await expect(visibleRows).toHaveCount(4);
            await expect(page.locator('#song-pagination')).toBeHidden();
            await search.fill('beta aria');
            await expect(visibleRows).toHaveCount(1);
            await expect(visibleRows.locator('.song-title')).toHaveText('Aria Math');

            await search.fill('no matching song');
            await expect(visibleRows).toHaveCount(0);
            await expect(page.locator('#song-empty')).toBeVisible();
            await expect(page.locator('#song-count')).toHaveText('0 of 58 tracks');
            await expect(page.locator('#song-pagination')).toBeHidden();

            await search.fill('');
            await expect(visibleRows).toHaveCount(8);
            await expect(page.locator('#song-empty')).toBeHidden();
            await expect(page.locator('#song-page-range')).toHaveText('1–8 of 58');
        } finally {
            await closeExtension(launch);
        }
    });

    test('pages through the catalog with bounded controls and resets paging when searching', async () => {
        const launch = await launchExtension();
        try {
            const page = await openPopupPage(launch.context, launch.extensionId);
            const search = await openSongs(page);
            const visibleRows = page.locator('.song-item:visible');
            const previous = page.getByRole('button', { name: 'Previous tracks', exact: true });
            const next = page.getByRole('button', { name: 'Next tracks', exact: true });
            const range = page.locator('#song-page-range');

            await expect(previous).toBeDisabled();
            await expect(next).toBeEnabled();
            const seen = await visibleRows.locator('.song-title').allTextContents();
            await next.focus();
            for (let pageIndex = 1; pageIndex < 8; pageIndex += 1) {
                await next.press('Enter');
                await expect(range).toHaveText(`${pageIndex * 8 + 1}–${Math.min((pageIndex + 1) * 8, 58)} of 58`);
                seen.push(...await visibleRows.locator('.song-title').allTextContents());
            }
            expect(seen).toHaveLength(58);
            expect(new Set(seen).size).toBe(58);
            await expect(visibleRows).toHaveCount(2);
            await expect(next).toBeDisabled();
            await expect(previous).toBeEnabled();
            await expect(previous).toBeFocused();

            await previous.click();
            await expect(range).toHaveText('49–56 of 58');
            await expect(visibleRows).toHaveCount(8);
            await expect(next).toBeEnabled();

            await search.fill('volume beta');
            await expect(range).toHaveText('1–8 of 30');
            await expect(previous).toBeDisabled();
            await next.click();
            await expect(range).toHaveText('9–16 of 30');
            await search.fill('');
            await expect(range).toHaveText('1–8 of 58');
            await expect(previous).toBeDisabled();
            await expect(visibleRows.locator('.song-title').first()).toHaveText('Key');

            await next.click();
            await previous.click();
            await expect(range).toHaveText('1–8 of 58');
            await expect(next).toBeFocused();
        } finally {
            await closeExtension(launch);
        }
    });

    test('plays and queues tracks from a later page without resetting the page', async () => {
        const launch = await launchExtension({ mockAudio: true });
        try {
            const page = await openPopupPage(launch.context, launch.extensionId);
            await openSongs(page);
            await page.getByRole('button', { name: 'Next tracks', exact: true }).click();
            await expect(page.locator('#song-page-range')).toHaveText('9–16 of 58');

            await page.getByRole('button', { name: 'Play Oxygene', exact: true }).click();
            await waitForNowPlaying(page, 'Oxygene');
            await waitForProgressToAdvance(page, { minimumDelta: 0.5 });
            await page.getByRole('button', { name: 'Add Equinoxe to queue', exact: true }).click();
            await expect.poll(() => getQueueTitles(page)).toEqual(['Equinoxe']);
            await expect(page.locator('#song-page-range')).toHaveText('9–16 of 58');
            await expect(page.locator('#now-playing')).toHaveText('Now Playing: Oxygene');
        } finally {
            await closeExtension(launch);
        }
    });

    test('plays a chosen song, queues another, and restores the queue on reopening', async () => {
        const launch = await launchExtension({ mockAudio: true });
        try {
            const page = await openPopupPage(launch.context, launch.extensionId);
            const search = await openSongs(page);
            await search.fill('Sweden');
            await page.getByRole('button', { name: 'Play Sweden', exact: true }).click();
            await waitForNowPlaying(page, 'Sweden');
            await waitForProgressToAdvance(page, { minimumDelta: 0.5 });
            await expect(page.locator('#duration-time')).toHaveText('1:30');

            await search.fill('Aria Math');
            await page.getByRole('button', { name: 'Add Aria Math to queue', exact: true }).click();
            await expect.poll(() => getQueueTitles(page)).toEqual(['Aria Math']);
            await expect(page.locator('#now-playing')).toHaveText('Now Playing: Sweden');
            await expect(page.locator('#assets-status')).toContainText('Aria Math');
            await expect.poll(async () => {
                const stored = await readStorage(page, ['playbackState']);
                return stored.playbackState?.queue.map(track => track.discId);
            }).toEqual(['Aria Math']);

            await page.close();
            const reopened = await openPopupPage(launch.context, launch.extensionId);
            await expect(reopened.locator('#now-playing')).toHaveText('Now Playing: Sweden');
            await expect.poll(() => getQueueTitles(reopened)).toEqual(['Aria Math']);
            await reopened.locator('#skip-next-btn').click();
            await waitForNowPlaying(reopened, 'Aria Math');
            await waitForProgressToAdvance(reopened, { minimumDelta: 0.5 });
            await expect(reopened.locator('#duration-time')).toHaveText('1:30');
            await reopened.locator('#skip-prev-btn').click();
            await waitForNowPlaying(reopened, 'Sweden');
        } finally {
            await closeExtension(launch);
        }
    });

    test('search typing leaves playback alone and song actions work with the keyboard', async () => {
        const launch = await launchExtension({ mockAudio: true });
        try {
            const page = await openPopupPage(launch.context, launch.extensionId);
            const search = await openSongs(page);
            await search.fill('Sweden');
            const play = page.getByRole('button', { name: 'Play Sweden', exact: true });
            await play.focus();
            await play.press('Space');
            await waitForNowPlaying(page, 'Sweden');
            await waitForProgressToAdvance(page, { minimumDelta: 0.5 });

            await page.locator('#play-pause-btn').click();
            await expect(page.locator('#play-pause-btn')).toHaveText('Play');
            const pausedAt = await getProgressValue(page);
            await search.fill('');
            await search.pressSequentially('moog city');
            await search.press('ArrowLeft');
            await search.press('ArrowRight');
            await expect(search).toHaveValue('moog city');
            await expect(page.locator('#play-pause-btn')).toHaveText('Play');
            expect(await getProgressValue(page)).toBeCloseTo(pausedAt, 1);

            await search.fill('Aria Math');
            const queue = page.getByRole('button', { name: 'Add Aria Math to queue', exact: true });
            await queue.focus();
            await queue.press('Enter');
            await expect.poll(() => getQueueTitles(page)).toEqual(['Aria Math']);
            await expect(page.locator('#play-pause-btn')).toHaveText('Play');
        } finally {
            await closeExtension(launch);
        }
    });
});
