# The Jukebox — Minecraft Music Player

A [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/) browser extension that brings a Minecraft-style jukebox into Chrome: click discs, queue tracks, shuffle ambient music, and optionally play **your own** Java Edition disc audio from local game files.

*Not affiliated with Mojang Studios or Microsoft.*

## Features

- **Jukebox mode** — Tap the central jukebox for a shuffled mix of Minecraft-style tracks (streamed from public archives).
- **Music discs** — Browse every disc in a collapsible “Music Discs” panel; left-click to play, right-click or Shift-click to queue.
- **Streaming + local audio** — Some discs use remote sources where available; others can be unlocked by pointing the extension at your **Minecraft Java Edition `assets`** folder (see [Local Minecraft audio](#local-minecraft-audio)).
- **Playback** — Play/pause, seek, skip, queue list, clear queue, volume (up to 300%), and **popup size** (small / medium / large).
- **Persistent library** — Selected assets and disc blobs are stored locally (extension storage + IndexedDB) so you don’t have to re-import every session.

## Requirements

- **Google Chrome** (or another Chromium browser that supports Manifest V3 extensions).
- For **full disc support**: **Minecraft: Java Edition** installed and the ability to select its `assets` folder (optional but recommended for grayed-out / locally sourced discs).

## Install (development)

1. Clone or download this repository.
2. Open Chrome → **Extensions** (`chrome://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose the project folder (the directory that contains `manifest.json`).

The extension name and version are defined in `manifest.json` (`name`, `version`).

## Local Minecraft audio

To use disc audio from your own game install (and to follow license-friendly behavior for tracks the extension cannot bundle), open the popup, expand **Music Discs**, and use **Use Local Minecraft Audio** to select your **`assets`** folder:

- **Windows:** e.g. `%AppData%\.minecraft\assets`
- **macOS:** e.g. `~/Library/Application Support/minecraft/assets`

Detailed steps and troubleshooting are in **`disc-help.html`** (also linked from the UI as **Info** when local audio is available). Platform-specific guides: `windowsinstructions.html`, `macOSinstructions.html`.

## Project layout

| Path | Role |
|------|------|
| `manifest.json` | Extension metadata, permissions, service worker, web-accessible help pages |
| `popup.html` / `app.js` / `styles.css` | Popup UI and playback logic |
| `background.js` | Service worker: messages, asset indexing, IndexedDB blobs |
| `offscreen.html` / `offscreen.js` | Offscreen document for audio playback |
| `shared.js` | Shared helpers (e.g. disc id normalization) |
| `assets/` | Icons, images, fonts |
| `disc-help.html`, `*instructions.html` | Help content for local audio setup |

## Permissions

- **`offscreen`** — Play audio in an offscreen document (required for reliable playback in MV3).
- **`storage`** — Persist UI preferences and indexed disc metadata.

## License

This project is licensed under [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/) — see [LICENSE](LICENSE).

**In short:** non-commercial use only; if you share or build on this work, you must **give appropriate credit** to the author. Read the full legal terms in `LICENSE`.

Copyright (c) 2026 Vaughn Bosu.
