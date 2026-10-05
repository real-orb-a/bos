# BOS — Broadcast Operator System
**Technical Specification & Implementation — v1.0**

BOS (Broadcast Operator System) is a cross-platform desktop broadcast-control and automation application built entirely with **Node.js** and **Electron**. BOS acts as the broadcast control and automation layer above **OBS Studio**, controlling scenes, dynamic scores, broadcast graphics, automated goal sequences, rolling replay capture, and slow-motion playback.

---

## Architecture Overview

```text
                         BOS
              Broadcast Operator System
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   Match Engine    Graphics Engine  Replay Engine
        │                │                │
        │                │                ▼
        │                │              FFmpeg
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
                  OBS WebSocket (v5)
                         │
                         ▼
                        OBS
                         │
                         ▼
                  Broadcast Output
```

---

## Directory Structure

```text
bos/
├── package.json               # Electron entry point & scripts
├── spec.md                    # Technical Specification v1.0
├── addon.md                   # Graphics, Animation & Transition Addendum v1.0
├── config/
│   └── bos.json               # Official broadcast configuration (OBS, teams, scenes, replays, hotkeys)
├── electron/
│   ├── main.js                # Electron main lifecycle & window orchestration
│   ├── preload.js             # Secure typed contextBridge API (window.bosAPI)
│   ├── config.js              # Configuration manager for bos.json
│   ├── obs/
│   │   ├── client.js          # OBS WebSocket v5 client with auto-reconnect & mock simulator
│   │   ├── scenes.js          # Scene switching & enumeration
│   │   ├── sources.js         # Media source playback, browser source refreshing & visibility
│   │   └── transitions.js     # Transition selection & duration management
│   ├── match/
│   │   ├── engine.js          # Match state machine, clock engine & sequence safety
│   │   ├── score.js           # Dynamic score tracking & team metadata
│   │   ├── events.js          # Chronological broadcast event logger
│   │   └── goalWorkflow.js    # 10-step automated goal sequence manager
│   ├── replay/
│   │   ├── engine.js          # Replay coordinator & OBS media playback
│   │   ├── buffer.js          # 180s rolling buffer calculation & management
│   │   ├── recorder.js        # Continuous video capture using FFmpeg (synthetic mode)
│   │   ├── cameras.js         # Multi-camera capture — one rolling buffer per camera view
│   │   ├── obsCapture.js      # Direct clip capture via OBS Replay Buffer over WebSocket
│   │   ├── clips.js           # Clip extraction, OBS-file adoption & trim pass
│   │   ├── sequence.js        # Clip sequence cycler (playlist) & cycle playback
│   │   └── slowmotion.js      # FFmpeg setpts & atempo slow-motion processing (1×, ½×, ¼×)
│   ├── graphics/
│   │   ├── engine.js          # Embedded HTTP (8088) & WebSocket server for OBS Browser Sources
│   │   ├── score.js           # Score bug data formatter & animation triggers
│   │   ├── goal.js            # Goal animation celebration payload formatter
│   │   ├── lowerThird.js      # Lower-third overlays & F1 status banners
│   │   └── messages.js        # Dynamic message presets & graphics queue
│   └── ipc/
│       └── handlers.js        # Secure IPC handlers for Electron
├── renderer/
│   ├── index.html             # Broadcast operator dashboard interface
│   ├── css/
│   │   ├── main.css           # Television dark-mode theme & master layout
│   │   └── components.css     # Goal triggers, scrubber timeline, clips shelf, preview drawer
│   └── js/
│       ├── app.js             # Master coordinator, OBS status sync, emergency abort, hotkeys
│       ├── match.js           # Goal triggers, score adjustments, match clock, event feed
│       ├── replay.js          # Manual replay generation, scrubber, clip playback
│       ├── graphics.js        # Lower-third controls, presets, on-air countdown, queue
│       └── settings.js        # Configuration modal & bos.json persistence
├── graphics/                  # Standalone HTML/CSS/JS OBS Browser Sources
│   ├── score/                 # Score bug (http://localhost:8088/graphics/score/)
│   ├── goal/                  # Goal celebration overlay (http://localhost:8088/graphics/goal/)
│   ├── lower-third/           # Dynamic lower-third & F1 banner (http://localhost:8088/graphics/lower-third/)
│   ├── replay/                # Replay watermark & speed badge (http://localhost:8088/graphics/replay/)
│   └── transitions/           # Custom graphical stinger wipe (http://localhost:8088/graphics/transitions/)
├── packages/                  # Pluggable Broadcast Animation Packages
│   └── ssl_media_2026/        # Example custom broadcast design package
└── replay_cache/              # Replay video segments and rendered clips
    ├── segments/              # FFmpeg rolling-buffer segments (synthetic mode)
    ├── obs/                   # OBS Replay Buffer save directory (clip auto-save path)
    ├── cameras/               # Per-camera rolling buffers & work files (cameras/<id>/)
    └── clips/                 # BOS clip library (replay-XXX adopted clips + index.json)
```

---

## Getting Started

### 1. Launch BOS
```bash
npm start
```
Or for development with DevTools enabled:
```bash
npm run dev
```

### 2. Connect OBS Studio
1. Open **OBS Studio** (v28 or newer).
2. Go to **Tools** → **WebSocket Server Settings**.
3. Enable WebSocket server on port `4455` (default).
4. BOS will automatically connect. If OBS is not running, BOS automatically runs in **Simulator Mode** so you can test and operate all features without interruption.

### 3. Add Browser Sources to OBS
Add Browser Sources in OBS pointing to the BOS graphics server (`http://localhost:8088/`):
- **Score Bug**: `http://localhost:8088/graphics/score/` (Width: 1920, Height: 1080)
- **Lower Third & Review**: `http://localhost:8088/graphics/lower-third/` (Width: 1920, Height: 1080)
- **Goal Celebration**: `http://localhost:8088/graphics/goal/` (Width: 1920, Height: 1080)
- **Replay Watermark**: `http://localhost:8088/graphics/replay/` (Width: 1920, Height: 1080)
- **Custom Stinger Wipe**: `http://localhost:8088/graphics/transitions/` (Width: 1920, Height: 1080)

---

## Replay Capture

BOS has two capture sources (set in Settings → **OBS WebSocket** tab, or
`config/bos.json → replay.captureSource`):

| Mode | How clips are captured | When to use |
| :--- | :--- | :--- |
| **`obs`** (default) | BOS talks to **OBS's own Replay Buffer** over the WebSocket (`StartReplayBuffer` → `SaveReplayBuffer`). OBS continuously buffers the real program output, and on a goal / manual replay BOS saves the buffer **automatically to the set path** `replay.obsReplayBuffer.savePath` (default `replay_cache/obs/`), trims it to your pre/post-roll window (`trimToWindow`), and adopts it into the clip library as `replay-001-…`. | Live broadcast — clips contain the real broadcast footage. |
| **`synthetic`** | BOS runs an FFmpeg rolling recorder (test pattern) and generates clips with FFmpeg. | Rehearsal / development / no OBS / replay buffer disabled. |

BOS finds the clip OBS saved three ways (in order): the `ReplayBufferSaved` event
(`savedReplayPath`), the `GetLastReplayBufferReplay` request, and a watch on the save
directory. If **any** step fails (or OBS is in Simulator mode), BOS automatically falls back
to synthetic clip generation so a replay is never lost.

### Multi-camera capture (per-camera-view clips)

BOS can capture from **every video source you add**, saving a separate clip **per camera
view** — so a goal produces a Main/Program clip *and* an independent clip from each camera.

Configure sources in `config/bos.json → replay.captureSources` (or add them after
enabling cameras):

```json
"captureSources": [
  { "id": "main", "name": "Main Program", "type": "obs", "enabled": true },
  { "id": "cam1", "name": "Camera 1", "type": "ffmpeg", "input": "synthetic", "enabled": true }
]
```

- **type `obs`** — the main program feed (OBS Replay Buffer, see above).
- **type `ffmpeg`** — BOS runs that camera's own independent **FFmpeg rolling buffer**.
  `input` is an FFmpeg input value: `"synthetic"` (labelled test pattern for rehearsal),
  a device (`v4l2:/dev/video0`, `dshow://…`, `av://…`) or a URL (`rtsp://…`, `http://…`).
  Live sources pace themselves, so the buffer truly rolls the last N seconds.

At capture time BOS saves a clip **from every enabled source** into the shared library with
📷 camera tags (e.g. `replay-004-cam1-goal.mp4`), and each clip records its **real
duration + camera + team/title** in `replay_cache/clips/index.json`. Clips are trimmed to the
pre/post-roll window like the main feed. Deleted camera output lands in `replay_cache/cameras/<id>/`.

**To use OBS capture:**
1. In OBS Studio enable the Replay Buffer output — **Settings → Output → Replay Buffer →
   Enable Replay Buffer** (or Advanced Output → Replay Buffer → enable).
2. BOS will find the output, point its save path at `replay.obsReplayBuffer.savePath` and
   set the buffer length (best-effort — the saved-file path is still detected if OBS
   rejects the setting), then start it automatically.
3. The Replay panel shows a live **OBS REPLAY BUFFER: ● ACTIVE** strip.

---

## Clip Sequence (cycle through clips)

BOS keeps an ordered **on-air clip sequence** — a playlist built from the saved clips in
the library, so you can cycle through several replays without hunting for files.

- **Build it:** click **SEQ ＋** on any clip in the Replay panel's clip library, or use the
  **Settings → Clip Sequence** tab to add clips, **↑/↓ to reorder/switch the order**, set a
  **speed per clip** (1× / ½× / ¼× slow-mo), remove clips, and clear the whole sequence.
  Camera-view clips show a 📷 tag so you can see which source each clip came from.
- **Play it:** the Replay panel's **CLIP SEQUENCE CYCLER** strip has **⏮ PREV / PLAY NEXT ▶**
  (hotkeys `[` and `]`), a **position readout** (`3 / 7`), and clickable clip chips. The
  cursor **wraps around** the end (LOOP toggle) so you keep cycling forever.
- **AUTO-NEXT** chains clips automatically: when a sequence clip finishes naturally, the
  next clip plays immediately. It never fires on manual STOP or the emergency return-to-live.
- The order, per-clip speed, loop and auto-advance flags persist in
  `config/bos.json` (`replay.sequence`, `replay.sequenceLoop`, `replay.sequenceAutoAdvance`),
  so the sequence survives restarts.

---

## Keyboard Shortcuts (Hotkeys)

| Action | Key | Description |
| :--- | :--- | :--- |
| **Garnet Goal** | `G` | Trigger 10-step automated Garnet goal sequence |
| **Topaz Goal** | `T` | Trigger 10-step automated Topaz goal sequence |
| **Create Replay** | `R` | Capture rolling buffer highlight and play to air |
| **Emergency Abort** | `L` | Instantly abort replays/graphics and Return to LIVE |
| **Under Review** | `U` | Show official "UNDER REVIEW" lower-third |
| **Hide Lower Third** | `H` | Clear active lower-third from air |
| **Match Clock** | `Space` | Start / Pause official match clock |
| **Previous Clip** | `[` | Play previous clip in the sequence |
| **Next Clip** | `]` | Play next clip in the sequence |

---

## Automated Goal Workflow

When the operator presses **GARNET GOAL** or **TOPAZ GOAL**:
1. **Record Event**: Records event in official match history log.
2. **Update Score**: Score increments (+1).
3. **Update Graphic**: Broadcasts animated score update to OBS score bug.
4. **Replay Capture**: Begins extracting replay clip concurrently in the background.
5. **Goal Animation**: Full-screen celebration graphic with Web Audio horn.
6. **Celebration**: Configured duration (default 3s).
7. **Replay 1×**: Transitions to Replay scene and plays highlight at normal speed.
8. **Replay ½×**: Plays slow-motion angle with speed watermark.
9. **Return to Live**: Transitions back to LIVE scene.

*At any point, the operator can click **RETURN TO LIVE** (`L`) or **SKIP SEQUENCE** to safely override and restore live broadcast output.*
