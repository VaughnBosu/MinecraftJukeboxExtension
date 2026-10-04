const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/g;
const AUDIO_PATTERN = /\.(mp3|ogg)(\?|$)/i;

const RUNTIME_URL_FILES = [
    'src/popup/catalog.js',
    'src/popup/popup.html',
    'src/popup/main.js',
    'src/background/index.js',
    'src/pages/disc-help.html',
    'src/pages/macOSinstructions.html',
    'src/pages/windowsinstructions.html'
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
        signal: AbortSignal.timeout(15_000),
        headers: isAudio ? { Range: 'bytes=0-0' } : undefined
    });

    // Some providers ignore Range. Read only the first chunk rather than
    // downloading every complete song merely to check provider health.
    const reader = response.body?.getReader();
    const firstChunk = reader ? await reader.read() : null;
    await reader?.cancel();
    const contentType = response.headers.get('content-type') || '';
    const accessControlAllowOrigin = response.headers.get('access-control-allow-origin');

    return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        bodyLength: firstChunk?.value?.byteLength || 0,
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
