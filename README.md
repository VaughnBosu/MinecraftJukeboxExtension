# The Jukebox — Minecraft Music Player

A Chrome extension for playing Minecraft music from your toolbar, with music discs, a searchable track library, and a shared playback queue.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/the-jukebox-minecraft-mus/mbibfcflbmlbcbnejgalgeijlpnjjgjc)

## Using the player

- Click the jukebox to start a shuffled selection of ten tracks.
- Open **Music Discs** to browse 21 discs. Click a disc to play it, or right-click or Shift-click to add it to the queue.
- Open **Other Tracks** to search all 58 tracks by title, album, or artist, or browse eight at a time with **Previous** and **Next**. Choose **Play** to start a track or **+** to add it to the queue. The libraries share the player's main scroll area; playback controls sit above them.
- Pause, seek, skip, adjust volume, or reorder and remove queued tracks. Music continues when you close the popup or player window.
- Drag the bottom-left corner to resize the toolbar popup directly. Your dimensions are remembered, within Chrome's 800 × 600px popup limit. You can also focus the corner and use the arrow keys to resize.
- Choose **Small**, **Medium**, or **Large** in **Size** to reset a custom popup size. The default is Small (360px wide); Medium is 480px and Large is 600px.
- Choose **Pop out ↗** for a larger player window you can move and resize. Its position and size are remembered, and opening it again focuses the existing window. In this window, **Size** changes the interface scale.

Some discs require local Minecraft audio. Streaming tracks require an internet connection, and availability depends on the external audio hosts.

## Local Minecraft audio

In **Music Discs**, choose **Use Local Minecraft Audio** and select the `assets` folder from your Minecraft Java Edition installation. It must contain the `indexes` and `objects` folders.

| Platform | Default assets location |
| --- | --- |
| Windows | `%AppData%\.minecraft\assets` |
| macOS | `~/Library/Application Support/minecraft/assets` |

Imported disc audio stays in the extension's local browser storage (IndexedDB); it is not uploaded to a server. Available discs depend on the game assets installed on your computer. Streaming playback separately connects to the audio hosts listed in [the catalog](src/popup/catalog.js).

## Development

The extension uses plain JavaScript, HTML, and CSS with Manifest V3. No build step is required.

```bash
git clone https://github.com/VaughnBosu/MinecraftJukeboxExtension.git
cd MinecraftJukeboxExtension
```

Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the repository folder. After editing the source, reload the extension from that page and reopen the player.

The source is organized into `src/popup` (player UI and catalog), `src/background` (playback state and window management), `src/offscreen` (audio playback), and `src/pages` (local audio help). Shared audio storage helpers are in `src/shared.js`.

### Testing

Install Node.js and npm, then run:

```bash
npm ci
npm run pw:install
npm run test:e2e
npm run test:e2e:live
```

The UI suite uses a generated 90-second WAV for remote streams and an OGG fixture for local imports. It exercises actual audio decoding, playback controls, search, queue management, responsive layouts, local audio persistence, and player windows without relying on external music hosts. The live suite separately checks audio URL responses, content types, CORS headers, and external links; it requires network access.

Use `npm run test:e2e:headed` to watch the UI suite. Set `PW_CHROMIUM_EXECUTABLE` to use an existing compatible Chromium executable. Failure screenshots, video, and traces are written to `test-results/` and are ignored by Git.

Before a release, run both suites and check the actual toolbar popup in Chrome: resize it by dragging and with the keyboard, reopen it to check saved dimensions, and switch all three size presets with the libraries expanded. Search and queue tracks, import local audio, and move, resize, close, and reopen the player window. Confirm playback continues and inspect the extension's error panel.

## Contributing

For bug reports, include your Chrome version, operating system, reproduction steps, and whether the track was streamed or imported locally. Keep changes focused and include relevant verification. Do not commit local game assets, browser profiles, or generated test output.

## License

See [LICENSE](LICENSE) for the project's CC BY-NC 4.0 license. Minecraft names, artwork, and music belong to their respective owners. This project is not affiliated with Mojang Studios or Microsoft.
