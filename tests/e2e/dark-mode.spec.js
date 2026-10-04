const fs = require('node:fs');
const path = require('node:path');
const { test, expect, chromium } = require('@playwright/test');

const extensionRoot = path.resolve(__dirname, '../..');
const popupHtml = fs.readFileSync(path.join(extensionRoot, 'src/popup/popup.html'), 'utf8');
const popupCss = fs.readFileSync(path.join(extensionRoot, 'src/popup/popup.css'), 'utf8');
const colorSchemeMeta = popupHtml.match(/<meta\s+name="color-scheme"[^>]*>/)?.[0] || '';
const artworkDirectory = path.join(extensionRoot, 'assets/images');
const discImages = fs.readdirSync(artworkDirectory)
    .filter(name => name.endsWith('.webp') && name !== 'jukebox.webp')
    .map(name => `data:image/webp;base64,${fs.readFileSync(path.join(artworkDirectory, name)).toString('base64')}`);

// Chromium may exclude chrome-extension:// pages from DevTools auto-dark
// emulation. Render the real popup CSS, theme metadata, and artwork in a normal
// document so this test actually exercises its image-recoloring algorithm.
function artworkDocument(scale) {
    return `<!doctype html><html><head><meta charset="utf-8">${colorSchemeMeta}
        <style>${popupCss}</style></head><body class="scale-${scale}">
        <div id="discs">${discImages.map(source => `<button class="disc"><img class="disc-image" src="${source}" alt=""></button>`).join('')}</div>
        </body></html>`;
}

test('automatic dark mode preserves disc artwork colors at both popup scales', async ({}, testInfo) => {
    const browser = await chromium.launch({
        channel: 'chromium',
        executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
        headless: process.env.PW_HEADFUL !== '1'
    });

    async function captureDiscs({ automaticDarkMode, scale }) {
        const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, colorScheme: 'dark' });
        try {
            // DevTools enables the dark media preference with automatic dark mode.
            // A fresh document avoids Chromium retaining previous image filters.
            const session = await page.context().newCDPSession(page);
            await session.send('Emulation.setAutoDarkModeOverride', { enabled: automaticDarkMode });
            await page.goto(`data:text/html,${encodeURIComponent(artworkDocument(scale))}`);
            const artwork = page.locator('#discs .disc-image');
            await expect(artwork).toHaveCount(21);
            await artwork.evaluateAll(images => Promise.all(images.map(image => image.decode())));
            await page.mouse.move(880, 1180);
            return await page.locator('#discs').screenshot({ animations: 'disabled', scale: 'css' });
        } finally {
            await page.close();
        }
    }

    try {
        for (const scale of ['small', 'large']) {
            const reference = await captureDiscs({ automaticDarkMode: false, scale });
            const automaticDarkMode = await captureDiscs({ automaticDarkMode: true, scale });
            await testInfo.attach(`${scale}-original-artwork`, { body: reference, contentType: 'image/png' });
            await testInfo.attach(`${scale}-automatic-dark-mode`, { body: automaticDarkMode, contentType: 'image/png' });
            expect(automaticDarkMode.equals(reference), `${scale} artwork pixels must retain their original colors`).toBe(true);
        }
    } finally {
        await browser.close();
    }
});
