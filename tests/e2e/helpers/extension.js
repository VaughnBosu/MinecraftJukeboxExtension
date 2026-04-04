const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

const EXTENSION_PATH = path.resolve(__dirname, '../../..');

async function waitForServiceWorker(context) {
    const existingWorker = context.serviceWorkers()[0];
    if (existingWorker) {
        return existingWorker;
    }

    return context.waitForEvent('serviceworker');
}

async function launchExtension(options = {}) {
    const userDataDir = options.userDataDir
        || await fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-jukebox-pw-'));

    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: process.env.PW_HEADFUL === '1' ? false : true,
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`
        ]
    });

    const serviceWorker = await waitForServiceWorker(context);
    const extensionId = new URL(serviceWorker.url()).host;

    return {
        context,
        extensionId,
        userDataDir
    };
}

async function openPopupPage(context, extensionId, { initScripts = [] } = {}) {
    const page = await context.newPage();

    for (const script of initScripts) {
        await page.addInitScript(script);
    }

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForSelector('.hero-disc');
    return page;
}

async function readStorage(page, keys) {
    return page.evaluate(storageKeys => new Promise(resolve => {
        chrome.storage.local.get(storageKeys, resolve);
    }), keys);
}

async function getQueueTitles(page) {
    return page.locator('.queue-item-title').allTextContents();
}

async function getProgressValue(page) {
    return page.locator('#progress-bar').evaluate(element => Number(element.value));
}

async function waitForNowPlaying(page, expectedText) {
    await expect.poll(async () => {
        return page.locator('#now-playing').textContent();
    }).toContain(expectedText);
}

async function waitForQueueLength(page, minimumLength) {
    await expect.poll(async () => {
        return page.locator('.queue-item').count();
    }).toBeGreaterThanOrEqual(minimumLength);
}

async function waitForProgressToAdvance(page, { minimumDelta = 0.5, timeout = 20_000 } = {}) {
    const startValue = await getProgressValue(page);
    await expect.poll(async () => {
        return getProgressValue(page);
    }, { timeout }).toBeGreaterThan(startValue + minimumDelta);
}

async function setRangeValue(page, selector, value) {
    await page.locator(selector).evaluate((element, nextValue) => {
        element.value = String(nextValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}

module.exports = {
    EXTENSION_PATH,
    getProgressValue,
    getQueueTitles,
    launchExtension,
    openPopupPage,
    readStorage,
    setRangeValue,
    waitForNowPlaying,
    waitForProgressToAdvance,
    waitForQueueLength
};
