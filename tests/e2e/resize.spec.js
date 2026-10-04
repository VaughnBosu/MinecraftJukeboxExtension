const { test, expect } = require('@playwright/test');
const { closeExtension, launchExtension, openPopupPage, readStorage } = require('./helpers/extension');

async function bodySize(page) {
    return page.locator('body').evaluate(body => {
        const { width, height } = body.getBoundingClientRect();
        return { width: Math.round(width), height: Math.round(height) };
    });
}

test('keyboard resizing persists and the original size preset resets custom dimensions', async () => {
    const launch = await launchExtension();
    try {
        const page = await openPopupPage(launch.context, launch.extensionId);
        const grip = page.getByRole('button', { name: 'Resize popup', exact: true });
        const initial = await bodySize(page);
        await grip.focus();
        await grip.press('ArrowLeft');
        await grip.press('Shift+ArrowLeft');
        await grip.press('Shift+ArrowUp');
        const expected = { width: initial.width + 60, height: initial.height - 50 };
        await expect.poll(() => bodySize(page)).toEqual(expected);
        await expect(page.locator('#ui-scale-select')).toHaveValue('custom');
        await expect(page.locator('body')).toHaveClass(/scale-small/);
        await expect.poll(async () => (await readStorage(page, ['popupSize'])).popupSize).toEqual(expected);

        await page.close();
        const reopened = await openPopupPage(launch.context, launch.extensionId);
        await expect.poll(() => bodySize(reopened)).toEqual(expected);
        await expect(reopened.locator('#ui-scale-select')).toHaveValue('custom');
        await reopened.locator('#ui-scale-select').selectOption('small');
        await expect.poll(async () => (await bodySize(reopened)).width).toBe(360);
        expect(await reopened.locator('body').evaluate(body => body.style.height)).toBe('');
        await expect.poll(async () => (await readStorage(reopened, ['popupSize'])).popupSize).toBeUndefined();
        await reopened.reload();
        await expect(reopened.locator('#ui-scale-select')).toHaveValue('small');
        await expect.poll(async () => (await bodySize(reopened)).width).toBe(360);
    } finally {
        await closeExtension(launch);
    }
});

test('dragging the bottom-left grip uses screen movement and keeps content scrollable', async () => {
    const launch = await launchExtension();
    try {
        const page = await openPopupPage(launch.context, launch.extensionId);
        await page.setViewportSize({ width: 900, height: 600 });
        const grip = page.getByRole('button', { name: 'Resize popup', exact: true });
        await grip.focus();
        await grip.press('Shift+ArrowLeft');
        await grip.press('Shift+ArrowLeft');
        const before = await bodySize(page);
        const bounds = await grip.boundingBox();
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + bounds.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 100, y - 40, { steps: 8 });
        await page.mouse.up();
        const expected = { width: before.width - 100, height: before.height - 40 };
        await expect.poll(() => bodySize(page)).toEqual(expected);
        await expect.poll(async () => (await readStorage(page, ['popupSize'])).popupSize).toEqual(expected);
        await expect(page.locator('body')).not.toHaveClass(/popup-resizing/);
        await page.locator('#disc-menu-toggle').click();
        await page.locator('.newsletter-btn').scrollIntoViewIfNeeded();
        await expect(page.locator('.newsletter-btn')).toBeInViewport();
        await expect(grip).toBeInViewport();
    } finally {
        await closeExtension(launch);
    }
});

test('custom dimensions respect popup limits and never constrain the player window', async () => {
    const launch = await launchExtension();
    try {
        const page = await openPopupPage(launch.context, launch.extensionId);
        await page.evaluate(() => chrome.storage.local.set({ popupSize: { width: 3000, height: 3000 }, uiScale: 'large' }));
        await page.reload();
        await expect.poll(() => bodySize(page)).toEqual({ width: 800, height: 600 });
        await expect(page.locator('body')).toHaveClass(/scale-large/);
        const grip = page.getByRole('button', { name: 'Resize popup', exact: true });
        await grip.focus();
        await grip.press('Shift+ArrowLeft');
        await grip.press('Shift+ArrowDown');
        await expect.poll(() => bodySize(page)).toEqual({ width: 800, height: 600 });

        await page.setViewportSize({ width: 1000, height: 700 });
        await page.goto(`${page.url()}?window=1`);
        await expect(grip).toHaveCount(0);
        await expect.poll(async () => (await bodySize(page)).width).toBe(1000);
        expect(await page.locator('body').evaluate(body => body.style.height)).toBe('');
        await expect(page.locator('#ui-scale-select')).toHaveValue('large');
    } finally {
        await closeExtension(launch);
    }
});

test('restored dimensions fit an unusually small available display', async () => {
    const launch = await launchExtension();
    try {
        const page = await openPopupPage(launch.context, launch.extensionId);
        await page.evaluate(() => chrome.storage.local.set({ popupSize: { width: 800, height: 600 } }));
        await page.addInitScript(() => {
            Object.defineProperty(screen, 'availWidth', { value: 340 });
            Object.defineProperty(screen, 'availHeight', { value: 240 });
        });
        await page.reload();
        await expect.poll(() => bodySize(page)).toEqual({ width: 340, height: 240 });
        const grip = page.getByRole('button', { name: 'Resize popup', exact: true });
        await grip.focus();
        await grip.press('Shift+ArrowRight');
        await grip.press('Shift+ArrowUp');
        await expect.poll(() => bodySize(page)).toEqual({ width: 340, height: 240 });
    } finally {
        await closeExtension(launch);
    }
});
