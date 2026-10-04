globalThis.MinecraftJukeboxBackground = globalThis.MinecraftJukeboxBackground || {};

importScripts(
    '/src/shared.js',
    '/src/background/library.js',
    '/src/background/playback.js',
    '/src/background/window.js',
    '/src/background/router.js'
);

chrome.runtime.setUninstallURL('https://forms.gle/7uGTedirTb5FxJT69');
