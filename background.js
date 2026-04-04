globalThis.MinecraftJukeboxBackground = globalThis.MinecraftJukeboxBackground || {};

importScripts(
    'shared.js',
    'background/library.js',
    'background/playback.js',
    'background/router.js'
);

try {
    chrome.runtime.setUninstallURL('https://forms.gle/7uGTedirTb5FxJT69');
} catch (error) {
    console.warn('[MinecraftJukebox] Failed to set uninstall URL', error);
}
