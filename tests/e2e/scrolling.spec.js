const { test, expect } = require('@playwright/test');
const { closeExtension, launchExtension, openPopupPage } = require('./helpers/extension');

async function outerScrollPosition(page) {
    // The toolbar popup constrains body height; a player window scrolls the root.
    return page.evaluate(() => window.scrollY + document.body.scrollTop);
}

async function moveOverVisibleTrack(page) {
    const point = await page.locator('.song-item:visible').evaluateAll(rows => {
        const body = document.body.getBoundingClientRect();
        const viewportBottom = Math.min(window.innerHeight, body.bottom);
        const candidates = rows.map(row => {
            const bounds = row.getBoundingClientRect();
            const top = Math.max(0, body.top, bounds.top);
            const bottom = Math.min(viewportBottom, bounds.bottom);
            return { x: bounds.left + bounds.width / 2, y: (top + bottom) / 2, height: bottom - top };
        }).filter(point => point.height > 10);
        return candidates.sort((a, b) => b.height - a.height)[0];
    });
    expect(point, 'At least one track should be visible for a real wheel gesture').toBeTruthy();
    await page.mouse.move(point.x, point.y);
}

for (const surface of [
    { name: '600px popup', width: 360, height: 600 },
    { name: 'minimum-height popup', width: 360, height: 280, custom: true },
    { name: 'narrow player window', width: 320, height: 520, popout: true }
]) {
    test(`wheel scrolling over Other Tracks moves the whole ${surface.name}`, async () => {
        const launch = await launchExtension({ viewport: { width: surface.width, height: surface.height } });
        try {
            const page = await openPopupPage(launch.context, launch.extensionId);
            if (surface.custom) {
                await page.evaluate(size => chrome.storage.local.set({ popupSize: size }), {
                    width: surface.width,
                    height: surface.height
                });
                await page.reload();
                await expect(page.locator('body')).toHaveCSS('height', `${surface.height}px`);
            }
            if (surface.popout) await page.goto(`${page.url()}?window=1`);

            await page.locator('#songs-menu-toggle').click();
            const rows = page.locator('.song-item:visible');
            await expect(rows).toHaveCount(8);
            expect(await page.evaluate(() => {
                const player = document.querySelector('.playback-bar');
                const libraries = document.querySelector('.disc-menu');
                return Boolean(player.compareDocumentPosition(libraries) & Node.DOCUMENT_POSITION_FOLLOWING)
                    && player.getBoundingClientRect().bottom <= libraries.getBoundingClientRect().top;
            }), 'Playback should appear before the library controls').toBe(true);

            await rows.first().evaluate(row => row.scrollIntoView({ block: 'center' }));
            await moveOverVisibleTrack(page);
            const beforeDown = await outerScrollPosition(page);
            await page.mouse.wheel(0, 120);
            await expect.poll(() => outerScrollPosition(page)).toBeGreaterThan(beforeDown + 20);
            await expect.poll(() => page.locator('#song-list').evaluate(list => list.scrollTop)).toBe(0);

            await moveOverVisibleTrack(page);
            const beforeUp = await outerScrollPosition(page);
            await page.mouse.wheel(0, -120);
            await expect.poll(() => outerScrollPosition(page)).toBeLessThan(beforeUp - 20);
            expect(await page.locator('#song-list').evaluate(list => list.scrollTop)).toBe(0);

            await page.locator('.queue-heading').scrollIntoViewIfNeeded();
            await expect(page.locator('.queue-heading')).toBeInViewport();
            await page.locator('#play-pause-btn').scrollIntoViewIfNeeded();
            await expect(page.locator('#play-pause-btn')).toBeInViewport();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
                && document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
        } finally {
            await closeExtension(launch);
        }
    });
}
