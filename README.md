# SLC — Sports Livestream Controller
**Adapted from the existing BOS implementation**

SLC is the in-place evolution of the existing BOS desktop application. It uses **Node.js**, **Electron**, and **OBS Studio** to manage sport and formal-event sessions, scores and clocks, live Athletics standings, broadcast graphics, and OBS replay capture and playback. The existing `bos.json` configuration remains supported for compatibility.

The operator renderer runs with `nodeIntegration: false`, `contextIsolation: true`, and
`sandbox: true`. Approved main-process operations are exposed through `window.slcAPI`;
`window.bosAPI` remains as a compatibility alias for the existing renderer modules.

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
│   ├── preload.js             # Secure contextBridge API (window.slcAPI; bosAPI compatibility alias)
│   ├── sessionManager.js      # Session setup, persistence, and unfinished-session recovery
│   ├── config.js              # Configuration manager for bos.json
│   ├── obs/
│   │   ├── client.js          # OBS WebSocket v5 client with auto-reconnect
│   │   ├── scenes.js          # Scene switching & enumeration
│   │   ├── sources.js         # Media source playback, browser source refreshing & visibility
│   │   └── transitions.js     # Transition selection & duration management
│   ├── match/
│   │   ├── engine.js          # Match state machine, clock engine & sequence safety
│   │   ├── score.js           # Dynamic score tracking & team metadata
│   │   ├── events.js          # Chronological broadcast event logger
│   │   └── goalWorkflow.js    # 10-step automated goal sequence manager
│   ├── replay/
│   │   └── engine.js          # Source Record capture and OBS Media Source playback
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
│       ├── replay.js          # Source Record capture controls
│       ├── session.js         # Session setup, recovery, and sport/event controls
│       ├── graphics.js        # Lower-third controls, presets, on-air countdown, queue
│       └── settings.js        # Configuration modal & bos.json persistence
├── graphics/                  # Standalone HTML/CSS/JS OBS Browser Sources
│   ├── score/                 # Score bug (http://localhost:8088/graphics/score/)
│   ├── screen-center-scorebug/# Screen center score bug (http://localhost:8088/graphics/screen-center-scorebug/)
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

### 0. Install and configure

Requirements: Windows 10/11 (or macOS/Linux for development), Node.js 20 or newer, and OBS Studio 28+ with the WebSocket server enabled.

```bash
npm install            # installs Electron, obs-websocket-js and ws
```

Configuration lives in `config/bos.json`. That file is **not** shipped in the release archive (it can hold your OBS password).
If you already have a `config/bos.json`, copy it into the new `config/` folder. Otherwise either copy
`config/bos.example.json` to `config/bos.json`, or just start BOS and fill in **Settings → OBS WebSocket**
(host, port, password). Replay triggers are configured in the same tab; goal automation remains in
**Settings → Goal Automation**. The OBS password is never displayed back in the UI: leaving the field blank keeps the saved one.

If `config/bos.json` is ever unreadable, BOS keeps a copy of it as `config/bos.json.corrupt-<time>` and tells you on start-up; it will never silently overwrite it.

The graphics server listens on `127.0.0.1:8088` by default. LAN access is opt-in: bind to a specific local interface address and list the exact OBS client IPs in `graphics.allowedClients`, for example `"graphics": { "host": "192.168.1.10", "allowedClients": ["192.168.1.25"] }`. Non-loopback HTTP and WebSocket peers are filtered by socket IP; an `Origin` header is not used as authentication. This is an IP access list for a trusted, firewall-restricted broadcast LAN, not encryption or cryptographic identity. Do not expose the port to untrusted networks; use a secured tunnel/VPN if traffic crosses one.

### 1. Launch SLC
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
4. SLC connects automatically and always talks to the **real OBS** — there is no simulator.
   If OBS isn't running you'll see `OBS ● DISCONNECTED` and SLC keeps retrying.

On launch, SLC shows an explicit broadcast-mode selection and session setup. An unfinished
session is offered for recovery, including its teams, score, period, sport state, live
Athletics event/results/houses, and paused clock state. Modes have session-scoped controls,
rosters, graphics, and replay where applicable; Athletics uses house standings instead of
team scoring. Basketball includes 1/2/3-point
scoring, a configurable game-clock start, and an independently controlled offense timer;
the offense timer is hidden from the scorebug until enabled in the basketball controls;
Cricket includes runs, wickets, and overs;
Volleyball, Table Tennis, and Badminton track points, sets/games, and win-by-two results.
Table Tennis setup supports singles (1v1) and doubles (2v2), with player names shown on the scorebug.
Football keeps match state, the clock, added time, goal controls, score correction, and its
event log together in the session control panel, with on-screen messages in the adjacent panel.
Athletics uses a dedicated event-control screen rather than a match scoreboard. It starts
with the configured houses and logos from the root `teams.json` file and supports additional
houses and their logos. Team and house names, short names, colors, and logos are configured
together there; logo paths are relative to the application root. The bundled Garnet, Emerald,
and Topaz PNGs are under `graphics/score/assets/houses/`. Add 2 to 16 distinct entries to the
`teams` array to use another school or competition's teams. Set `"active": false` to hide an
entry from all team and house lists; set it to `true` to include it. At least two teams must be
active. If omitted, `active` defaults to `true`. Sports setup selects two active entries;
Athletics uses every active entry as a house.

Each entry in `teams.json` has an `id`, `name`, optional `active` boolean and `shortName`,
six-digit hex `color` and `secondaryColor`, and an application-root-relative PNG, JPEG, or SVG
`logo` path. For example:

```json
{
  "teams": [
    {
      "id": "north-school",
      "name": "North School",
      "active": true,
      "shortName": "NORTH",
      "color": "#2563eb",
      "secondaryColor": "#172554",
      "logo": "logos/north-school.png"
    },
    {
      "id": "south-school",
      "name": "South School",
      "active": false,
      "shortName": "SOUTH",
      "color": "#dc2626",
      "secondaryColor": "#7f1d1d",
      "logo": "logos/south-school.png"
    }
  ]
}
```
Operators set one live event label (for example, “200m Level 01 Boys”) and can edit it at any
time; there is no event schedule or results-publishing step. Running and Baton Relay entries
immediately update the live leaderboard and can be removed to correct a placing. Shot Put
records six turns per athlete, displays each distance in an attempts table, and ranks athletes
by their best valid distance. Baton Relay runner handoffs animate on the broadcast graphic.
All three event types contribute to event and house standings; points are omitted from the
event graphic. The operator can switch the on-air graphic from live standings to a podium
with first-, second-, and third-place names over their house logos. Overall house points and
medals remain in the operator standings. Athletics uses a standings-first operator layout
with the event clock and scrollable controls in the main area; full-size Notices and Replay
panels stay anchored in a separate right-side rail and scroll internally. Sports session setup
selects teams from `teams.json` and applies each entry's logo and colors to the scoreboard and
broadcast graphics.
The broadcast event standings use a compact, scorebug-sized leader card and expand smoothly
to the full results list with **EXPAND STANDINGS**.
Formal Event mode provides participant/speaker records
and programme lower-third cues without match controls or the scorebug.

Session metadata and recovery snapshots are stored as `slc-session.json` under Electron's
user-data directory. Legacy `bos.json` configuration remains in place so
existing OBS, team, graphics, and replay settings are not discarded during the migration.

### 3. Add Browser Sources to OBS
Add Browser Sources in OBS pointing to the BOS graphics server (`http://localhost:8088/`):
- **Score Bug**: `http://localhost:8088/graphics/score/` (Width: 1920, Height: 1080)
- **Screen Center Score Bug**: `http://localhost:8088/graphics/screen-center-scorebug/` (Width: 1920, Height: 1080)
- **Lower Third & Review**: `http://localhost:8088/graphics/lower-third/` (Width: 1920, Height: 1080)
- **Goal Celebration**: `http://localhost:8088/graphics/goal/` (Width: 1920, Height: 1080)
- **Replay Watermark**: `http://localhost:8088/graphics/replay/` (Width: 1920, Height: 1080)
- **Custom Stinger Wipe**: `http://localhost:8088/graphics/transitions/` (Width: 1920, Height: 1080)
- **Volleyball Scoreboard**: `http://localhost:8088/graphics/volleyball/` (Width: 1920, Height: 1080)
- **Basketball Scoreboard**: `http://localhost:8088/graphics/basketball/` (Width: 1920, Height: 1080)

For sports, the scorebug uses a fixed-pixel horizontal bar with square house logos at the
outside, short names (GAR, EME, TOP) and scores across the center, and the match clock between
the scores. Expanded mode replaces those codes with full house names and centers the configured
match name above the score row; toggle it with
**EXPAND SCOREBUG** / **COLLAPSE SCOREBUG** in the session controls. Athletics replaces this
bar with live ranked standings, or an operator-selected three-place podium with athlete names
over their house logos. **EXPAND STANDINGS** reveals the full athlete/relay results and house
logos. Scale the OBS Browser Source as a whole with the programme canvas.

### Screen Center Score Bug

A second, standalone browser source displays the **same expanded score bug** dead center of the screen. It phases in from the center point (scale-up + fade) and fades back out to reveal the normal corner score bug. Use it for key moments when you want the score front-and-centre on programme.

**Behaviour:**
- **FADE CENTER SCOREBUG IN** — the corner score bug fades out and the center score bug phases in from screen center at expanded size. Both graphics stay in sync via the same WebSocket state, so scores, clock, period, and team identities always match.
- **FADE CENTER SCOREBUG OUT** — the center bug fades out and the corner score bug fades back in.
- While the center score bug is visible, the normal score bug toggle is disabled and cannot be operated until the center bug has faded back out.

Add it as an OBS Browser Source at `http://localhost:8088/graphics/screen-center-scorebug/` and position it above your corner score bug source in the OBS stack.

Replace the bundled square placeholder house logos in
`graphics/score/assets/houses/` with final PNG artwork when available. Uploaded team/house
logos take precedence over those defaults.

Basketball sessions use quarter labels, an independently configurable game-clock start time,
and a configurable Offense Timer. Team scores can be adjusted individually by one, two, or
three points in either direction. Competition/event display names are limited to 60 characters
to preserve spacing in the operator and broadcast layouts.

Volleyball sessions let operators configure the regular-set target, deciding-set target, and
win-by margin. The expanded scorebug displays a live estimate of how many more points the
leading team needs to win the current set, with the point score centered above a smaller set
tally. Cricket's scorebug shows innings, wickets, and overs. Clock controls are hidden for
score-based sports that do not use a match clock; Athletics retains its event stopwatch.

---

## Replay Capture and Playback

Replay capture is owned by the **Source Record** OBS plugin — SLC's Save Replay button
asks OBS to trigger Source Record's "Save Replay Buffer" hotkey over the WebSocket
(`TriggerHotkeyByName`). After capture, operators can select a video through Electron's
native file picker, load it into the configured OBS Media Source, switch to the REPLAY
scene, and stop/return LIVE manually or automatically when playback ends.

```text
SLC Save Replay → OBS WebSocket → Source Record filter → replay file
Operator selects file → OBS Media Source → REPLAY scene → LIVE when stopped/ended
```

- **Replay panel** → **SAVE REPLAY** (or `R`) fires the hotkey. A request-state readout shows
  `IDLE → TRIGGERING → TRIGGERED | ERROR` (the state of the *request*, not the video).
- **AIR REPLAY** loads the selected file into the OBS media source configured by
  `scenes.replayMediaSource` and switches to the configured REPLAY scene. **STOP & RETURN
  LIVE** stops playback and switches back to the configured LIVE scene.
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

Playback requires an OBS Media Source (default name `Replay Video`) and a configured REPLAY
scene. SLC supports MP4, MOV, MKV, AVI, WebM, M4V, and TS selections. Videos remain in
their original location; SLC does not copy or delete them.

## House Colours

Three houses drive the broadcast palette: **Garnet (Red)**, **Emerald (Green)** and
**Topaz (Yellow)**. Team names, short names, colors, and logos are configured in `teams.json`,
then selected for each session. Dynamic graphics use the selected team's color.

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

## Testing

```bash
npm test               # backend smoke tests, session/sport state, replay workflows, and graphics/OBS integration helpers
```
