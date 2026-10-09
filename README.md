# FAR OUT ☮ — a psychedelic music visualizer

Old-school Windows Media Player / Winamp-style visuals, rebuilt with WebGL2 and melted a little.
It listens to **whatever your computer is playing** — including **YouTube Music**, Spotify, SoundCloud, anything — and turns it into tunnels, mandalas, fractals and lava lamps that react to the beat.

- 12 scenes: cosmic halo, mandalas, Julia-set fractals, beat-pulsed hex tunnels, lava-lamp blobs, acid oscilloscope, a "Media Player 2002" bars homage, and more
- Real beat detection (kick drums trigger pulses, rings and color kicks)
- Auto-journey between scenes, or pick your own
- Click and drag to paint on the visuals
- No accounts, no servers, nothing leaves your machine

> ⚠️ **Photosensitivity warning:** contains flashing lights and fast motion. Use the **Intensity** slider (or press `[`) to calm it down.

---

## Quick start (pick one)

### Option A — Electron app (recommended: no picker, hears everything)

Captures all system audio directly (Windows WASAPI loopback). Just press play in your browser.

Requirements: [Node.js](https://nodejs.org) 18+ on Windows.

```bash
git clone https://github.com/afgonczol/far-out-visualizer.git
cd far-out-visualizer
npm install
npm start
```

Or double-click **`start-app.bat`** (installs Electron on first run, then launches).

Then play music on [music.youtube.com](https://music.youtube.com) in your normal browser. The visualizer starts listening automatically. Press `F11` or `F` for fullscreen.

### Option B — Chrome / Edge (no install besides a browser)

Browsers can't hear other apps on their own, so you share the tab with audio:

1. Run **`start-chrome.bat`** (needs Python 3 on PATH; it serves the page on `http://localhost:5177` and opens it).
   Or run `python -m http.server 5177` in this folder and open <http://localhost:5177> yourself.
2. Start music in a normal tab at music.youtube.com.
3. In Far Out, click **Capture my music**.
4. In Chrome's picker choose the **Chrome Tab** with YouTube Music and tick **"Also share tab audio"**.
   *(Or choose **Entire Screen** and tick **"Share system audio"** to hear everything.)*
5. Press `F` for fullscreen. The music keeps playing in its background tab.

Use Chrome or Edge on desktop. Firefox and Safari don't support tab-audio capture.

### No music handy?
Click **Demo synth** for a built-in beat, or **Mic / line-in** to listen through a microphone or a "Stereo Mix" device.

---

## Controls

| Key | Action |
|---|---|
| `Space` / `→` | next scene |
| `←` | previous scene |
| `1`–`9`, `0` | jump to a scene |
| `A` | auto-journey on/off |
| `F` (or double-click) | fullscreen |
| `H` | hide all UI |
| `[` / `]` | intensity down / up |
| `Q` | render quality (low / medium / high) |
| `C` | change audio source |
| `M` | mute demo synth |
| click + drag | paint |

Move the mouse to show the control bar; it fades out after a few seconds.

## Troubleshooting

- **"I'm not hearing anything" banner** — in the Chrome picker you must tick *Also share tab audio* (tab) or *Share system audio* (screen). Press `C` to pick again.
- **Visuals freeze when another window covers Far Out (Chrome)** — Chrome pauses hidden windows. Put Far Out fullscreen or on a second monitor, or use the Electron app, which keeps rendering.
- **Choppy on a weak GPU** — it lowers its resolution automatically; press `Q` to force low quality.
- **`start-chrome.bat` can't find Python** — install Python 3, or use Option A.
- **Audio capture button disabled** — the page must be served from `localhost` or `https`, not opened as a plain file path.

## How it works

Audio goes through the Web Audio `AnalyserNode` into a log-spaced spectrum, an oscilloscope waveform, four auto-gained frequency bands and beat/onset detection. A WebGL2 video-feedback loop (the same trick behind MilkDrop and WMP "Ambience") warps, rotates and hue-shifts the previous frame, then paints a new audio-driven shape over it. A post pass adds bloom, chromatic aberration and tonemapping. Captured audio is analysed only and never played back, so there's no echo.

```
index.html        page + UI
src/audio.js      capture, analysis, beat detection, demo synth
src/shaders.js    GLSL (feedback + post passes, six "emitters")
src/main.js       scenes, render loop, input
electron/main.js  Electron wrapper (system-audio loopback)
```

## License

MIT
