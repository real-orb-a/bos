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
│   │   └── engine.js          # Source Record trigger — fires "Save Replay Buffer" hotkey
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
└── replay_cache/              # (reserved — Source Record owns replay file storage)
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
4. BOS connects automatically and always talks to the **real OBS** — there is no simulator.
   If OBS isn't running you'll see `OBS ● DISCONNECTED` and BOS keeps retrying.

### 3. Add Browser Sources to OBS
Add Browser Sources in OBS pointing to the BOS graphics server (`http://localhost:8088/`):
- **Score Bug**: `http://localhost:8088/graphics/score/` (Width: 1920, Height: 1080)
- **Lower Third & Review**: `http://localhost:8088/graphics/lower-third/` (Width: 1920, Height: 1080)
- **Goal Celebration**: `http://localhost:8088/graphics/goal/` (Width: 1920, Height: 1080)
- **Replay Watermark**: `http://localhost:8088/graphics/replay/` (Width: 1920, Height: 1080)
- **Custom Stinger Wipe**: `http://localhost:8088/graphics/transitions/` (Width: 1920, Height: 1080)

---

## Replay Capture (Source Record)

BOS **no longer records, generates or plays replays itself**. Replay capture is owned
entirely by the **Source Record** OBS plugin — BOS's Replay button simply asks OBS to
trigger Source Record's "Save Replay Buffer" hotkey over the WebSocket
(`TriggerHotkeyByName`). Airing/playing the saved file is a future phase.

```text
BOS Replay button → OBS WebSocket TriggerHotkeyByName → Source Record filter → replay file
```

- **Replay panel** → **SAVE REPLAY** (or `R`) fires the hotkey. A request-state readout shows
  `IDLE → TRIGGERING → TRIGGERED | ERROR` (the state of the *request*, not the video).
- **Per-source hotkeys** — each entry in `replay.captureSources` may define its own
  `hotkeyName` / `contextName`, so every camera/source can save through the correct
  Source Record filter:

```json
{
  "enabled": true,
  "hotkeyName": "ReplayBuffer.Save",
  "contextName": "Game Capture - Source Record",
  "captureSources": [
    { "id": "main", "name": "Main Program", "enabled": true, "hotkeyName": "ReplayBuffer.Save", "contextName": "" },
    { "id": "cam1", "name": "Camera 1",     "enabled": true, "hotkeyName": "ReplayBuffer.Save", "contextName": "" }
  ]
}
```

The exact hotkey/context names depend on the Source Record filters in your OBS scene
collection — set them in **Settings → OBS WebSocket → Source Record Replay Capture** (or
directly in `config/bos.json`). Goal workflow: **Settings → Goal Automation → "Trigger
Source Record replay save on goal"**.

## House Colours

Three houses drive the broadcast palette: **Garnet (Red)**, **Emerald (Green)** and
**Topaz (Yellow)**. The home/away team colours are set from these houses in **Settings →
Teams & Branding → HOUSE PALETTES** (one-tap swatches), and every dynamic graphic — score
bug, goal celebration, lower-third accent, custom transition — uses the team's colour.

---

## Keyboard Shortcuts (Hotkeys)

| Action | Key | Description |
| :--- | :--- | :--- |
| **Garnet Goal** | `G` | Trigger automated Garnet goal sequence |
| **Topaz Goal** | `T` | Trigger automated Topaz goal sequence |
| **Save Replay** | `R` | Trigger Source Record "Save Replay Buffer" hotkey |
| **Emergency Abort** | `L` | Abort the goal sequence and Return to LIVE |
| **Under Review** | `U` | Show official "UNDER REVIEW" lower-third |
| **Hide Lower Third** | `H` | Clear active lower-third from air |
| **Match Clock** | `Space` | Start / Pause official match clock |

---

## Automated Goal Workflow

When the operator presses **GARNET GOAL** or **TOPAZ GOAL**:
1. **Record Event**: Records event in official match history log.
2. **Update Score**: Score increments (+1) and the score graphic animates with the team colour.
3. **Goal Animation**: Full-screen celebration graphic (Garnet / Emerald / Topaz colour).
4. **Replay Trigger**: BOS triggers the Source Record "Save Replay Buffer" hotkey
   (`captureReplayOnGoal`); Source Record writes the file — BOS does no video work.
5. **Celebration**: Configured duration (default 3s).
6. **Return to Live**: Returns the program to the LIVE scene.

*At any point, the operator can click **RETURN TO LIVE** (`L`) or **SKIP SEQUENCE** to safely override and restore live broadcast output.*
