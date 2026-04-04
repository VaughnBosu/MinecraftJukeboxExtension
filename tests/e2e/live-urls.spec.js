const { test, expect } = require('@playwright/test');
const {
    extractRuntimeUrls,
    mapWithConcurrency,
    probeUrl
} = require('./helpers/runtime-urls');

test.describe('Live Runtime URLs', () => {
    test.setTimeout(180_000);

    test('all audio stream URLs are live and CORS-usable', async () => {
        const urls = await extractRuntimeUrls();
        const audioUrls = urls.filter(entry => entry.isAudio);

        const results = await mapWithConcurrency(audioUrls, 6, async entry => {
            try {
                const probe = await probeUrl(entry.url, { isAudio: true });
                return { entry, probe };
            } catch (error) {
                return {
                    entry,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });

        const failures = results.filter(({ probe, error }) => {
            if (error) {
                return true;
            }

            return !probe.ok
                || !probe.contentType.toLowerCase().startsWith('audio/')
                || !probe.accessControlAllowOrigin;
        });

        expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    });

    test('all non-audio runtime links respond successfully', async () => {
        const urls = await extractRuntimeUrls();
        const nonAudioUrls = urls.filter(entry => !entry.isAudio);

        const results = await mapWithConcurrency(nonAudioUrls, 6, async entry => {
            try {
                const probe = await probeUrl(entry.url, { isAudio: false });
                return { entry, probe };
            } catch (error) {
                return {
                    entry,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });

        const failures = results.filter(({ probe, error }) => {
            if (error) {
                return true;
            }

            return !probe.ok;
        });

        expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    });
});
