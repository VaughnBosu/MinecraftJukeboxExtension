# The Jukebox — Minecraft Music Player
A chrome extension that adds a Minecraft Jukebox straight into your browser! Click discs, queue tracks, shuffle ambient music, and optionally play your own Java Edition disc audio from local game files.

*Not affiliated with Mojang Studios or Microsoft.*

## Background
In Minecraft, the jukebox is one of the most iconic blocks — drop in a music disc and your world comes alive with C418's ambient masterpieces. But what if you didn't have to be in-game to enjoy them? This extension brings that experience to your browser. Browse over 20 music discs, queue up tracks, shuffle ambient mixes, and even unlock your full local disc library by pointing the extension at your Minecraft Java Edition assets folder.

## How does it work?
1. Click the jukebox icon in your browser toolbar to open the popup.
2. Tap the central jukebox button for a **shuffled mix** of Minecraft ambient tracks (streamed from public archives).
3. Expand the **Music Discs** panel to browse every disc — left-click to play, right-click or Shift-click to queue.
4. Use playback controls: play/pause, seek, skip, rewind/forward 10 seconds, and volume up to **300%**.
5. Optionally point the extension at your **Minecraft Java Edition `assets`** folder to unlock grayed-out discs that can't be streamed.

## Supported Discs
Each disc plays its authentic Minecraft track:

**13** · **Cat** · **Blocks** · **Chirp** · **Far** · **Mall** · **Mellohi** · **Stal** · **Strad** · **Ward** · **Wait** · **11** · **5** · **Otherside** · **Pigstep** · **Relic** · **Creator** · **Creator (Music Box)** · **Precipice** · **Tears** · **Lava Chicken**

Plus **The Jukebox** — a shuffled ambient mix of all tracks.

## Local Minecraft Audio
To use disc audio from your own game install, open the popup, expand **Music Discs**, and use **Use Local Minecraft Audio** to select your `assets` folder:

- **Windows:** `%AppData%\.minecraft\assets`
- **macOS:** `~/Library/Application Support/minecraft/assets`


## Development

### Installation
```bash
git clone https://github.com/null3000/MinecraftJukeboxExtension.git
```

### Running the Extension
No build step required — load the unpacked extension directly:
- **Chrome**: `chrome://extensions` → Enable **Developer mode** → **Load unpacked** → select project root


## Contributing
Like the project? Please consider contributing to this project, lots of improvements and optimizations can be made.

[![Available in the Chrome Web Store](https://user-images.githubusercontent.com/19192015/132961666-64cf372a-ad35-47ad-b378-4de4b4a07d6d.png)](https://chromewebstore.google.com/detail/the-jukebox-minecraft-mus/mbibfcflbmlbcbnejgalgeijlpnjjgjc)
