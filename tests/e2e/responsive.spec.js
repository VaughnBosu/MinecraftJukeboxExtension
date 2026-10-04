const { test, expect } = require('@playwright/test');
const {
    closeExtension,
    launchExtension,
    openPopupPage,
    readStorage
} = require('./helpers/extension');

async function expandLibraries(page) {
    for (const selector of ['#disc-menu-toggle', '#songs-menu-toggle']) {
        const toggle = page.locator(selector);
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
}

async function expectArtwork(page) {
    await expect(page.locator('#discs .disc-image')).toHaveCount(21);
    await expect.poll(() => page.locator('.disc-image').evaluateAll(images => images.every(image => {
        const bounds = image.getBoundingClientRect();
        return image.complete && image.naturalWidth > 0 && bounds.width > 0 && bounds.height > 0;
    }))).toBe(true);
    // Local-only tracks should stay recognizable in their original colors.
    await expect(page.locator('#discs .disc.disabled').first()).toHaveCSS('filter', 'none');
}

async function expectNoHorizontalOverflow(page) {
    const sizes = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        bodyWidth: document.body.clientWidth,
        bodyScroll: document.body.scrollWidth
    }));
    expect(sizes.document).toBeLessThanOrEqual(sizes.viewport + 1);
    expect(sizes.bodyScroll).toBeLessThanOrEqual(sizes.bodyWidth + 1);
}

test('popup size changes preserve artwork, keep expanded controls reachable, and persist', async ({}, testInfo) => {
    const launch = await launchExtension();
    try {
        const page = await openPopupPage(launch.context, launch.extensionId);
        await expandLibraries(page);

        for (const [size, width] of [['small', 360], ['medium', 480], ['large', 600], ['small', 360]]) {
            // Chrome constrains action popups to 600px high.
            await page.setViewportSize({ width, height: 600 });
            await page.locator('#ui-scale-select').selectOption(size);
            await expect(page.locator('body')).toHaveClass(new RegExp(`scale-${size}`));
            await expect.poll(() => page.locator('body').evaluate(body => body.getBoundingClientRect().width)).toBe(width);
            await expectArtwork(page);
            await expectNoHorizontalOverflow(page);

            for (const selector of ['#song-search', '#play-pause-btn', '.newsletter-btn']) {
                await page.locator(selector).scrollIntoViewIfNeeded();
                await expect(page.locator(selector)).toBeInViewport();
            }

            await page.locator('#disc-menu-toggle').scrollIntoViewIfNeeded();
            const screenshotPath = testInfo.outputPath(`${size}-expanded.png`);
            await page.screenshot({ path: screenshotPath });
            await testInfo.attach(`${size}-expanded.png`, {
                path: screenshotPath,
                contentType: 'image/png'
            });
        }

        await expect.poll(async () => (await readStorage(page, ['uiScale'])).uiScale).toBe('small');
        await page.close();
        const reopened = await openPopupPage(launch.context, launch.extensionId);
        await expect(reopened.locator('#ui-scale-select')).toHaveValue('small');
        await expect(reopened.locator('#disc-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
        await expectArtwork(reopened);
    } finally {
        await closeExtension(launch);
    }
});

test('player window remains usable at narrow and wide sizes with every text scale', async ({}, testInfo) => {
    const launch = await launchExtension();
    try {
        const page = await openPopupPage(launch.context, launch.extensionId);
        await page.goto(`${page.url()}?window=1`);
        await expandLibraries(page);
        await expect(page.locator('#popout-btn')).toBeHidden();

        for (const width of [320, 360, 480, 600, 1000]) {
            await page.setViewportSize({ width, height: 520 });
            for (const scale of ['small', 'medium', 'large']) {
                await page.locator('#ui-scale-select').selectOption(scale);
                await expectNoHorizontalOverflow(page);
                await expectArtwork(page);
                await page.locator('.newsletter-btn').scrollIntoViewIfNeeded();
                await expect(page.locator('.newsletter-btn')).toBeInViewport();
                await page.locator('#song-search').scrollIntoViewIfNeeded();
                await expect(page.locator('#song-search')).toBeInViewport();
                if (width === 320 && scale === 'large') {
                    const screenshotPath = testInfo.outputPath('narrow-player-window.png');
                    await page.screenshot({ path: screenshotPath });
                    await testInfo.attach('narrow-player-window.png', { path: screenshotPath, contentType: 'image/png' });
                }
            }
        }
    } finally {
        await closeExtension(launch);
    }
});
