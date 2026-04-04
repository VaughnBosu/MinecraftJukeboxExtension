const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/g;
const AUDIO_PATTERN = /\.(mp3|ogg)(\?|$)/i;

const RUNTIME_URL_FILES = [
    'popup/catalog.js',
    'popup.html',
    'popup/main.js',
    'background.js',
    'disc-help.html',
    'macOSinstructions.html',
    'windowsinstructions.html'
];

async function extractRuntimeUrls() {
    const discovered = new Map();

    for (const relativeFile of RUNTIME_URL_FILES) {
        const absoluteFile = path.join(ROOT, relativeFile);
        const contents = await fs.readFile(absoluteFile, 'utf8');
        for (const match of contents.matchAll(URL_PATTERN)) {
            const url = match[0];
            if (!discovered.has(url)) {
                discovered.set(url, new Set());
            }
            discovered.get(url).add(relativeFile);
        }
    }

    return Array.from(discovered.entries()).map(([url, files]) => ({
        url,
        files: Array.from(files).sort(),
        isAudio: AUDIO_PATTERN.test(url)
    }));
}

async function probeUrl(url, { isAudio = false } = {}) {
    const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: isAudio ? { Range: 'bytes=0-0' } : undefined
    });

    const body = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || '';
    const accessControlAllowOrigin = response.headers.get('access-control-allow-origin');

    return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        bodyLength: body.byteLength,
        contentType,
        accessControlAllowOrigin
    };
}

async function mapWithConcurrency(items, limit, iteratee) {
    const results = new Array(items.length);
    let currentIndex = 0;

    async function worker() {
        while (currentIndex < items.length) {
            const nextIndex = currentIndex;
            currentIndex += 1;
            results[nextIndex] = await iteratee(items[nextIndex], nextIndex);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
}

module.exports = {
    extractRuntimeUrls,
    mapWithConcurrency,
    probeUrl
};
