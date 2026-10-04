const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

const EXTENSION_PATH = path.resolve(__dirname, '../../..');

// A real, silent PCM stream keeps playback/seek tests independent of third-party
// availability while still exercising Chromium's audio decoder and offscreen page.
function createAudioFixture() {
    const sampleRate = 8000;
    const dataLength = sampleRate * 2 * 90;
    const buffer = Buffer.alloc(44 + dataLength);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
}

const AUDIO_FIXTURE = createAudioFixture();
const audioFixtures = new Map();

async function getAudioFixture(userDataDir) {
    if (audioFixtures.has(userDataDir)) return audioFixtures.get(userDataDir);

    const fixture = { failSources: new Set(), requests: [] };
    fixture.server = http.createServer((request, response) => {
        const source = new URL(request.url, 'http://localhost').searchParams.get('source') || '';
        const failed = Array.from(fixture.failSources).some(part => source.includes(part));
        fixture.requests.push({ source, failed });
        response.writeHead(failed ? 503 : 200, {
            'access-control-allow-origin': '*',
            'content-type': failed ? 'text/plain' : 'audio/wav',
            'content-length': failed ? 0 : AUDIO_FIXTURE.length
        });
        response.end(failed ? undefined : AUDIO_FIXTURE);
    });
    await new Promise((resolve, reject) => {
        fixture.server.once('error', reject);
        fixture.server.listen(0, '127.0.0.1', resolve);
    });
    fixture.url = `http://127.0.0.1:${fixture.server.address().port}/audio.wav`;
    audioFixtures.set(userDataDir, fixture);
    return fixture;
}

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
        executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
        viewport: options.viewport,
        headless: process.env.PW_HEADFUL === '1' ? false : true,
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`
        ]
    });

    let audioFixture;
    if (options.mockAudio !== false) {
        audioFixture = await getAudioFixture(userDataDir);
        // Playwright routes do not intercept Chrome's offscreen-document media.
        // Substitute only remote media inputs at the popup message boundary;
        // the real background/offscreen transport and audio decoder still run.
        await context.addInitScript(fixtureUrl => {
            if (!globalThis.chrome?.runtime?.sendMessage) return;
            const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
            const fixtureSource = source => /^https?:\/\//i.test(source || '')
                ? `${fixtureUrl}?source=${encodeURIComponent(source)}` : source;
            chrome.runtime.sendMessage = (...args) => {
                const message = args[0];
                if (['playDisc', 'queueDisc'].includes(message?.type)) {
                    args[0] = {
                        ...message,
                        objectUrl: fixtureSource(message.objectUrl),
                        ...(message.streamFallbacks ? { streamFallbacks: message.streamFallbacks.map(fixtureSource) } : {})
                    };
                }
                return sendMessage(...args);
            };
        }, audioFixture.url);
    }

    const serviceWorker = await waitForServiceWorker(context);
    const extensionId = new URL(serviceWorker.url()).host;

    return {
        context,
        extensionId,
        userDataDir,
        audioFixture
    };
}

async function closeExtension({ context, userDataDir }) {
    await context.close();
    const fixture = audioFixtures.get(userDataDir);
    if (fixture) {
        audioFixtures.delete(userDataDir);
        await new Promise(resolve => {
            fixture.server.close(resolve);
            fixture.server.closeAllConnections();
        });
    }
    await fs.rm(userDataDir, { recursive: true, force: true });
}

async function openPopupPage(context, extensionId, { initScripts = [] } = {}) {
    const page = await context.newPage();

    for (const script of initScripts) {
        await page.addInitScript(script);
    }

    await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
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
};
