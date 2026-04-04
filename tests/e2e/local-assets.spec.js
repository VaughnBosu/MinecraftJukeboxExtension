const { test, expect } = require('@playwright/test');
const {
    launchExtension,
    openPopupPage,
    waitForNowPlaying,
    waitForProgressToAdvance
} = require('./helpers/extension');
const {
    cleanupFixture,
    createLocalAssetsFixture
} = require('./helpers/local-assets');

async function expandDiscMenu(page) {
    const toggle = page.locator('#disc-menu-toggle');
    const panel = page.locator('#disc-menu-panel');

    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.click();
    }

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
}

const DISABLE_DIRECTORY_PICKERS = () => {
    try {
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: undefined
        });
        Object.defineProperty(window, 'showOpenFilePicker', {
            configurable: true,
            value: undefined
        });
    } catch (error) {
        window.showDirectoryPicker = undefined;
        window.showOpenFilePicker = undefined;
    }
};

test('local asset upload enables local-only discs and survives relaunch', async () => {
    const fixture = await createLocalAssetsFixture(['13', 'stal']);
    const launch = await launchExtension();

    try {
        const firstPopup = await openPopupPage(launch.context, launch.extensionId, {
            initScripts: [DISABLE_DIRECTORY_PICKERS]
        });

        await firstPopup.waitForTimeout(500);
        await expandDiscMenu(firstPopup);
        await expect(firstPopup.locator('[data-disc-id="13"]')).toHaveClass(/disabled/);
        await expect(firstPopup.locator('#select-assets-btn')).toBeVisible();

        const chooserPromise = firstPopup.waitForEvent('filechooser');
        await firstPopup.locator('#select-assets-btn').click();
        const chooser = await chooserPromise;
        await chooser.setFiles(fixture.root);

        await expect(firstPopup.locator('#assets-status')).toContainText(/Disc upload successful|Loaded discs|Your discs are ready/i);
        await expect(firstPopup.locator('[data-disc-id="13"]')).not.toHaveClass(/disabled/);

        await firstPopup.locator('[data-disc-id="13"]').click();
        await waitForNowPlaying(firstPopup, '13');
        await waitForProgressToAdvance(firstPopup, { minimumDelta: 0.5 });

        await launch.context.close();

        const relaunch = await launchExtension({ userDataDir: launch.userDataDir });
        try {
            const secondPopup = await openPopupPage(relaunch.context, relaunch.extensionId, {
                initScripts: [DISABLE_DIRECTORY_PICKERS]
            });

            await secondPopup.waitForTimeout(1000);
            await expandDiscMenu(secondPopup);
            await expect(secondPopup.locator('[data-disc-id="13"]')).not.toHaveClass(/disabled/);

            await secondPopup.locator('[data-disc-id="13"]').click();
            await waitForNowPlaying(secondPopup, '13');
            await waitForProgressToAdvance(secondPopup, { minimumDelta: 0.5 });
        } finally {
            await relaunch.context.close();
        }
    } finally {
        await cleanupFixture(fixture);
    }
});
