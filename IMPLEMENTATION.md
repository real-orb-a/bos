# BOS — Broadcast Operator System
## Implementation Reference & Code Spec (v1.0)

> This document explains **what the code in this repository actually does** — how BOS is
> built, what every module is responsible for, how data flows through the system, and how
> the pieces fit together. It is the implementation companion to `spec.md` (requirements)
> and `addon.md` (graphics/animation requirements).

---

## 1. What BOS Is

BOS is a cross-platform **desktop broadcast-control application** built on **Node.js + Electron**.
It sits *above* OBS Studio: the operator presses buttons in the BOS dashboard, and BOS
orchestrates OBS, FFmpeg, and HTML/CSS/JS broadcast graphics to run a sports TV broadcast.

The division of labour (the core principle from the spec — §31):

| System | Knows |
| :--- | :--- |
| **BOS** | WHAT should happen, WHEN, and WHY |
| **OBS** | HOW the final video is composited and output |
| **FFmpeg** | HOW replay media is captured and processed |
| **Graphics (Browser Sources)** | HOW broadcast graphics are rendered and animated |

Everything in the app runs in **Node.js**. There is no Windows-only code — FFmpeg is invoked
as an external binary, and OBS is reached over WebSocket, so the same code runs on
Windows / macOS / Linux.

---

## 2. Application Architecture

```text
                     BOS (Electron)
        ┌───────────────────────────────┐
        │        MAIN PROCESS           │
        │  ┌──────────┬──────────────┐  │
        │  │  MATCH   │    REPLAY    │  │
        │  │  ENGINE  │    ENGINE    │  │
        │  └────┬─────┴──────┬───────┘  │
        │     OBS │       FFmpeg       │
        │   ┌─────▼──────────▼───────┐  │
        │   │    GRAPHICS ENGINE     │  │
        │   │   HTTP :8088 + WebSocket│ │
        │   └────────────────────────┘  │
        └──────────────┬────────────────┘
                       │ IPC (window.bosAPI)
        ┌──────────────▼────────────────┐
        │          RENDERER             │
        │     Dashboard (HTML/CSS/JS)   │
        └───────────────────────────────┘
                │                │
                ▼                ▼
        OBS Studio ────────  Browser Sources
        (WebSocket :4455)   (ws://localhost:8088)
```

Two processes, one job:

* **Main process** (`electron/`) — owns OBS, FFmpeg, the match/score state, and the graphics
  server. Nothing privileged is exposed to the UI except through typed IPC calls.
* **Renderer** (`renderer/`) — the operator dashboard. It only calls `window.bosAPI.*` and
  renders the UI. It cannot touch OBS, the filesystem, or FFmpeg directly.

---

## 3. Repository Layout

```text
bos/
├── package.json               # "npm start" → electron ., "npm test" → node test.js
├── spec.md                    # Original requirements spec (v1.0)
├── addon.md                   # Graphics & animation addendum (v1.0)
├── IMPLEMENTATION.md          # THIS FILE
│
├── config/bos.json            # The single JSON configuration file
│
├── electron/                  # ── MAIN PROCESS (all privileged work happens here) ──
│   ├── main.js                # Electron lifecycle, wiring, window creation
│   ├── preload.js             # Exposes the secure window.bosAPI bridge to the renderer
│   ├── config.js              # ConfigManager: read/write config/bos.json
│   ├── obs/                   # OBS WebSocket controller (v5)
│   │   ├── client.js          #   connection, auth, auto-reconnect, ping, simulator mode
│   │   ├── scenes.js          #   scene switching / enumeration
│   │   ├── sources.js         #   media playback, browser refresh, source visibility
│   │   └── transitions.js     #   transition selection + duration
│   ├── match/                 # Match / score engine
│   │   ├── engine.js          #   match state machine + match clock
│   │   ├── score.js           #   home/away score tracking
│   │   ├── events.js          #   chronological event log
│   │   └── goalWorkflow.js    #   the automated 10-step goal sequence
│   ├── replay/                # Replay engine
│   │   ├── engine.js          #   replay coordinator (play/stop/status)
│   │   ├── buffer.js          #   rolling buffer window model (default 180s)
│   │   ├── recorder.js        #   continuous FFmpeg segment capture (synthetic mode)
│   │   ├── cameras.js         #   multi-camera capture — one rolling buffer per camera view
│   │   ├── obsCapture.js      #   direct clip capture via OBS Replay Buffer (WebSocket)
│   │   ├── clips.js           #   clip generation, OBS-file adoption, clip index & trim pass
│   │   ├── sequence.js        #   clip sequence cycler (playlist) & cycle playback
│   │   └── slowmotion.js      #   FFmpeg setpts/atempo slow-motion (½×, ¼×)
│   ├── graphics/              # Graphics engine
│   │   ├── engine.js          #   HTTP(:8088) + WebSocket server for OBS Browser Sources
│   │   ├── score.js           #   SCORE_UPDATE payload builder
│   │   ├── goal.js            #   GOAL_ANIMATION payload builder
│   │   ├── lowerThird.js      #   lower-third lifecycle + auto-dismiss timer
│   │   ├── messages.js        #   message presets + graphics queue
│   │   └── packages.js        #   broadcast package manager (loader; see §14.5)
│   └── ipc/handlers.js        # All Electron IPC channels + event fan-out to the UI
│
├── renderer/                  # ── RENDERER (the operator dashboard) ──
│   ├── index.html             # Dashboard markup (header, panels, settings modal)
│   ├── css/main.css           # Layout + dark broadcast theme
│   ├── css/components.css     # Component styles (buttons, cards, badges)
│   └── js/
│       ├── app.js             # Coordinator: OBS status, program badge, hotkeys
│       ├── match.js           # Score, goals, match state, clock, event feed
│       ├── replay.js          # Replay form, timeline scrubber, clips shelf
│       ├── graphics.js        # Lower thirds, presets, queue panel
│       └── settings.js        # Settings modal ↔ config/bos.json
│
├── graphics/                  # ── OBS Browser Sources (HTML/CSS/JS graphics) ──
│   ├── score/                 # Score bug
│   ├── goal/                  # Full-screen goal celebration
│   ├── lower-third/           # Lower third + F1-style status banner
│   ├── replay/                # Replay watermark / speed badge / progress bar
│   └── transitions/           # Custom stinger (sliding panels) transition
│
├── packages/ssl_media_2026/   # Example pluggable "broadcast package" (see §14)
├── media/                     # (reserved) animations / transitions / audio assets
└── replay_cache/              # FFmpeg segment + clip storage (created at runtime)
    ├── segments/              #   2-second rolling segments from the recorder
    └── clips/                 #   Generated replay clips (.mp4)
```

---

## 4. How the Application Starts

1. `package.json` sets `main` to `electron/main.js` and `npm start` runs the Electron binary.
2. `main.js` (`initializeApp`) constructs every backend component in dependency order:
   `ConfigManager → ScoreManager → EventLogger → MatchEngine → OBSClient → Scenes/Sources/
   Transitions → GraphicsEngine → ReplayEngine → GoalWorkflowManager`.
3. It creates the dashboard `BrowserWindow` (1480×940, dark theme, `nodeIntegration: false` —
   the renderer is sandboxed).
4. `registerIpcHandlers(...)` installs every IPC channel and subscribes main-process events
   so they can be forwarded to the dashboard. The renderer loads `renderer/index.html`.
5. `OBSClient.connect()` fires — if OBS Studio isn't running, BOS automatically switches to
   **Simulator mode** (see §9.4) so the operator can still practise and run cues.
6. On quit, `before-quit` tears down the replay recorder, graphics server, match clock, and
   the OBS socket.

The renderer **never** reads/writes the filesystem, spawns processes, or talks to OBS. All
privileged operations are reachable only through the typed `window.bosAPI` bridge (§5).

---

## 5. The IPC Bridge (`electron/preload.js` + `electron/ipc/handlers.js`)

The renderer runs with `nodeIntegration: false`. The preload script is the only thing that
can import Electron APIs in the renderer, so it exposes a single typed object:

```js
// In the renderer, this is the ONLY way to reach the backend:
window.bosAPI.<group>.<method>(...)
```

### 5.1 Request/Response (renderer → main)

`bosAPI` groups map one-to-one onto `ipcMain.handle` channels in `handlers.js`:

| Group | Example calls | Backs onto |
| :--- | :--- | :--- |
| `obs` | `connect()`, `getStatus()`, `switchScene(name)`, `setTransition(name)`, `getScenes()` | `obs:*` handlers → OBS client/controllers |
| `match` | `getState()`, `setState(s)`, `clockToggle()`, `setPeriod(p)`, `setClock({...})` | `match:*` → MatchEngine |
| `score` | `addHome(1)`, `subtractAway(1)`, `set({home,away})`, `reset()`, `updateTeams(data)` | `score:*` → ScoreManager |
| `events` | `get(limit)`, `record(type, details)`, `clear()` | `events:*` → EventLogger |
| `replay` | `getStatus()`, `createClip(opts)`, `play(clip, speed, autoReturnLive)`, `stop()`, `deleteClip(f)`, `setBufferDuration(s)` | `replay:*` → ReplayEngine |
| `sequence` | `getState()`, `add(entry)`, `remove(i)`, `move(from,to)`, `setSpeed(i,s)`, `setLoop(v)`, `setAutoAdvance(v)`, `setCurrent(i)`, `playNext()`, `playPrevious()`, `playIndex(i)`, `clear()` | `sequence:*` → ClipSequenceManager |
| `graphics` | `showLowerThird(data)`, `hideLowerThird()`, `getPresets()`, `enqueue(item)`, `removeFromQueue(id)`, `clearQueue()`, `triggerGoalAnimation(team, opts)`, `triggerTransition(data)` | `graphics:*` → GraphicsEngine |
| `workflow` | `triggerGoal(team, opts)`, `abort()`, `getStatus()` | `goal:*` → GoalWorkflowManager |
| `system` | `emergencyAbort()` | master safety: abort workflow + stop replay + hide graphics + switch LIVE |
| `config` | `get(key)`, `set(key, value)`, `updateAll(newConfig)` | `config:*` → ConfigManager |

### 5.2 Events (main → renderer)

`handlers.js` subscribes to every subsystem's EventEmitter and forwards to the UI:

| Event | Channel delivered on |
| :--- | :--- |
| OBS connected / disconnected / scene changed / ping latency | `obs:statusChanged`, `obs:sceneChanged`, `obs:ping` |
| Score changed / teams updated | `score:changed`, `score:teamsUpdated` |
| Clock tick (1s) / clock changed / state changed / temp state changed | `match:clockTick`, `match:clockChanged`, `match:stateChanged`, `match:tempStateChanged` |
| Event log updates | `events:added`, `events:cleared` |
| Replay playback started / tick / stopped / clip created | `replay:started`, `replay:tick`, `replay:stopped`, `replay:clipCreated` |
| Graphics queue changed | `graphics:queueUpdated` |
| Goal workflow started / step / completed / aborted | `workflow:started`, `workflow:step`, `workflow:completed`, `workflow:aborted` |

This is the *only* channel for state to travel back to the dashboard, so the main process
remains the single source of truth.

---

## 6. ConfigManager (`electron/config.js`)

- Loads `config/bos.json` on startup; if it is missing or corrupt, it falls back to a
  sensible default configuration (GARNET/TOPAZ, LIVE/REPLAY/GRAPHICS scenes, 180s buffer…).
- `get("dot.path")` — dotted access, e.g. `cfg.get("obs.port")`.
- `set("dot.path", value)` — writes the value **and persists to disk** immediately, then
  emits a `changed` event (so other subsystems can react).
- `updateAll(newConfig)` — shallow-merges a whole config object (used by the Settings modal).

Everything broadcast-critical — host/port/password, team names/colours, scene names, replay
durations, transitions, hotkeys, goal workflow toggles — lives in this file, **not** in code.
---

## 7. OBS Controller Layer (`electron/obs/`)

### 7.1 OBSClient (`client.js`) — the WebSocket gateway

Wraps `obs-websocket-js` (protocol v5). Responsibilities:

- **Connect / authenticate** — connects to `ws://<host>:<port>` (default `localhost:4455`)
  with the configured password (if any).
- **Auto-reconnect** — on `ConnectionClosed` it schedules a retry (default every 3 s,
  `obs.reconnectIntervalMs`). A `reconnectTimer` guard prevents overlapping retries.
- **Liveness ping** — every 5 s it calls `GetVersion` and measures round-trip latency for
  the `ms` readout in the dashboard header.
- **Scene/stream/record awareness** — listens to OBS notifications
  (`CurrentProgramSceneChanged`, `StreamStateChanged`, `RecordStateChanged`) and re-emits
  them as BOS events, which `handlers.js` forwards to the dashboard.
- **Replay buffer awareness** — subscribes to `ReplayBufferStateChanged` (active/saving
  status shown in the Replay panel) and `ReplayBufferSaved` (the exact `savedReplayPath` of
  each saved clip), so the capture engine (§11.3a) knows precisely where OBS wrote the file.
- **Simulator mode** (`enableMockMode`) — if OBS can't be reached, BOS sets `isMockMode`.
  Every `call(...)` is then answered by `_mockCall(...)` (current scene, scene list, stream
  and record status), so scenes and media actions work without OBS running (see §9.4).

The `call(requestType, requestData)` method is the single choke point: in mock mode it
returns canned responses, in real mode it delegates to OBS.

### 7.2 ScenesController (`scenes.js`)

- `switchScene(name)` → `SetCurrentProgramScene`.
- `switchToLive()` / `switchToReplay()` / `switchToGraphics()` read the scene names from
  config (`scenes.liveScene` etc.) — BOS never hard-codes scene names.
- `getScenes()` / `getCurrentScene()` for the dashboard's scene monitor.

### 7.3 SourcesController (`sources.js`)

- `setMediaSourceFile(file, loop)` — loads a replay clip into the OBS Media Source
  (`SetInputSettings` with `local_file`, `restart_on_activate`).
- `playMedia()` / `stopMedia()` — `TriggerMediaInputAction` RESTART / STOP.
- `refreshBrowserSource(name)` — `PressInputPropertiesButton` → `refreshnocache`.
- `setSourceVisible(scene, itemId, visible)` — `SetSceneItemEnabled`.

The media source name is configurable (`scenes.replayMediaSource`, default `"Replay Video"`).

### 7.4 TransitionsController (`transitions.js`)

- `getTransitions()` → `GetSceneTransitionList`.
- `getCurrentTransition()` → name + duration.
- `setTransition(name)` → `SetCurrentSceneTransition`, persisted to config.
- `setDuration(ms)` → `SetCurrentSceneTransitionDuration`, persisted to config.

These drive OBS' scene-to-scene transitions (Cut / Fade / Swipe / Stinger). Custom
*graphical* transitions are a separate graphics-layer feature (§13.5).

---

## 8. Match Engine Layer (`electron/match/`)

### 8.1 MatchEngine (`engine.js`) — state machine + clock

- **Official states** (`MatchEngine.States`): `PRE_MATCH`, `LIVE`, `HALF_TIME`,
  `LIVE_SECOND_HALF`, `FULL_TIME`, `BREAK`, `DELAYED`, `UNDER_REVIEW`.
- **Temporary states** (`MatchEngine.TemporaryStates`): `NONE`, `GOAL`, `REPLAY`,
  `SLOW_MOTION`, `GRAPHIC_ACTIVE`. A temporary state also records *which sequence* is active
  (`isSequenceRunning` + `activeSequenceName`).
- `canStartSequence(name, force=false)` — the **conflict guard**: if a sequence is already
  running, a new automated sequence is refused *unless the operator passes `force`*
  (explicit override). This is what stops a replay sequence being interrupted accidentally.
- **Match clock** — a 1 s interval ticks while running. Supports start / pause / toggle /
  reset / direct set. Period presets (`1st Half` → 0:00, `2nd Half` → 45:00,
  `Extra Time` → 90:00) and stoppage-time minutes (`+N` shown next to the clock).
  Every tick is broadcast to the graphics (so the on-air scorebug clock runs live) and to
  the dashboard.
- `getFullState()` returns match state + temp state + clock + score in one object.

### 8.2 ScoreManager (`score.js`)

- Holds `home` / `away` team objects (name, short, colours, logo, score), seeded from config.
- `addHome/subtractHome/addAway/subtractAway` clamp at ≥ 0 and emit `scoreChanged` with
  before/after values.
- `setScore`, `resetScore`, `updateTeams` for bulk changes / team rebranding.
- **Important:** scores *persist to `config/bos.json`* on every change (`_persist`), so a
  restart does not lose the match state.

### 8.3 EventLogger (`events.js`)

- `recordEvent(type, details)` — appends a stamped event (`id`, `isoTime`, `displayTime`,
  type, details) to the top of an in-memory list (capped at 200).
- The goal workflow logs `GOAL` events (team + match clock + timestamp); the clock engine
  logs `CLOCK_START/PAUSE/RESET`, period changes and match-state changes.
- The dashboard renders these as a scrolling event feed.

---

## 9. Graphics Engine & Message Protocol (`electron/graphics/`)

The graphics engine (`engine.js`) is a small **HTTP + WebSocket server** that serves the OBS
Browser Sources and pushes live state to them. It binds port `8088` (`graphics.httpPort`).

### 9.1 Static HTTP server

- Serves the project root, so Browser Sources load from URLs like
  `http://localhost:8088/graphics/score/` (a directory request auto-resolves to `index.html`).
- Correct MIME types for HTML/CSS/JS/JSON/images/SVG/MP3/MP4, and `Access-Control-Allow-Origin: *`.
- The root `/` page lists the available Browser Source URLs (handy for adding them in OBS).

### 9.2 WebSocket server & state sync

- Hosted on the same port at path `/ws` via the `ws` package.
- Every Browser Source opens one WebSocket when its page loads and **reconnects every 2 s**
  if the connection drops (that is how graphics self-heal after a BOS restart).
- On connect, BOS sends an `INITIAL_SYNC` snapshot (current score/clock, lower-third state,
  replay-overlay state) so a reconnecting graphic immediately shows the *current* on-air look.

### 9.3 BOS → graphics messages

| Type | Payload | Consumed by |
| :--- | :--- | :--- |
| `INITIAL_SYNC` | `{score, lowerThird, replayOverlay}` | all |
| `SCORE_UPDATE` | `{home, away, clock, animation: pop\|flip\|flash\|update, changedTeam, timestamp}` | score bug |
| `CLOCK_UPDATE` | `{clock}` | score bug |
| `LOWER_THIRD_SHOW` | `{title, subtitle, duration, position, animation, style, timestamp}` | lower-third |
| `LOWER_THIRD_HIDE` | `{timestamp}` | lower-third |
| `GOAL_ANIMATION` | `{team:{name,short,color,secondaryColor,score}, player, assist, duration, timestamp}` | goal |
| `REPLAY_OVERLAY_SHOW` | `{title, speed, team, duration}` | replay |
| `REPLAY_OVERLAY_HIDE` | — | replay |
| `TRIGGER_TRANSITION` | `{id, title}` | transitions |

The score bug is updated automatically: `ScoreManager` fires `scoreChanged`,
`engine.js` turns it into a single `SCORE_UPDATE` (using the animation type requested by the
workflow, e.g. `flip` for goals, `pop` for manual buttons), and the clock ticks are streamed
as `CLOCK_UPDATE` every second.

### 9.4 Simulator mode (OBS-less operation)

When OBS Studio is unavailable, `OBSClient.enableMockMode()` makes every OBS call return
canned data (`GetCurrentProgramScene`, `SetCurrentProgramScene`, `GetSceneList`, stream and
record status). The graphics server and all sequences still work, so BOS remains fully
operable for rehearsal, development and testing. The dashboard labels this state
`OBS ● SIMULATOR (READY)`; auto-reconnect keeps probing for real OBS in the background.

### 9.5 Graphics → BOS messages

Browser Sources can signal BOS over the same socket; the engine re-emits them:

| Type | Meaning |
| :--- | :--- |
| `TRANSITION_COVERED` | The custom transition graphic has fully covered the screen — safe to switch OBS content underneath |
| `TRANSITION_FINISHED` | The transition animation has completed and hidden itself |

These are the coordination hooks the Addendum (§22–23) calls for. (In v1.0 the replay engine
currently uses a fixed 500 ms wait instead of consuming `COVERED`; see §21.)

---

## 10. The Five Browser Source Graphics (`graphics/`)

Each graphic is a self-contained mini web-app that connects to `/ws`, listens for messages,
and animates itself with HTML/CSS. BOS only supplies data; the graphic owns its look.

| Browser Source | URL | What it does |
| :--- | :--- | :--- |
| **score** | `…/graphics/score/` | Score bug: team names/shorthands, colour bars, running clock + period, animated score numerals (`pop` / `flip` CSS animations) |
| **lower-third** | `…/graphics/lower-third/` | Lower third + F1-style banner: title/subtitle, status badge ("OFFICIAL NOTICE"), position (`bottom-left`…), style classes (`standard`, `alert`, `f1-banner`), slide-in via CSS |
| **goal** | `…/graphics/goal/` | Full-screen celebration: team name, "GOAL!", team-color glow, light rays, player/assist text, updated score — plus a **Web-Audio horn** (no audio file needed). Auto-hides after the configured duration |
| **replay** | `…/graphics/replay/` | Persistent replay indicator: REPLAY badge, speed (`1×`, `½×`), clip title, live progress bar |
| **transitions** | `…/graphics/transitions/` | Custom stinger: two sliding panels (vertical wipe) + center badge (logo mark, title strip). Plays ~1.1 s, sends `TRANSITION_COVERED` at 500 ms and `TRANSITION_FINISHED` at 1100 ms |

The graphics are deliberately *dumb*: they hold no match data and simply obey the messages
from BOS, which keeps BOS as the single source of truth.

---

## 11. Replay Engine Layer (`electron/replay/`)

### 11.1 Recorder (`recorder.js`) — the rolling buffer (synthetic mode)

- Spawns a single **FFmpeg** process at startup (`startRecording`) that continuously writes
  2-second segments of a synthetic feed (`testsrc2` with a burnt-in clock).
- Segments are written to `replay_cache/segments/` with a `segment_wrap` history sized to the
  configured buffer (default 180 s) — OLD segments are overwritten in place.
- **Input pacing is deliberately off (`-re` is not used).** On recent FFmpeg builds,
  `-re` / `-readrate` prevent the segment muxer from rolling segments (only one file is ever
  produced); live devices/URLs pace themselves anyway, and the synthetic pattern encodes fast.
- **This FFmpeg recorder only runs in `captureSource: "synthetic"` mode.** In the default
  `"obs"` mode (§11.3a) the rolling buffer lives inside OBS itself; multi-camera FFmpeg
  rolling buffers are owned by `CameraManager` (§11.3c).

### 11.2 Buffer model (`buffer.js`)

- Tracks a time window of `bufferSeconds` (config: 60 / 90 / 120 / 180 / 300).
- `calculateClipWindow(eventTime, preRoll, postRoll)` computes the exact extraction window:
  `start = event − preRoll`, `end = event + postRoll`, `duration = pre + post`
  (defaults 8 s before / 7 s after a goal, both configurable).
- `setBufferDuration(seconds)` lets the operator shrink/extend the buffer live (min 30 s).

### 11.3 Clip generation & adoption (`clips.js` + `obsCapture.js`)

Clips enter the library one of two ways:

**a) OBS Replay Buffer capture (default — `captureSource: "obs"`).**
`ObsReplayBufferCapture` (`obsCapture.js`) captures the **real program output** straight
from OBS over the WebSocket:
1. `ensurePrepared()` finds the OBS `replay_buffer` output, best-effort points its save
   path at `replay.obsReplayBuffer.savePath` (`replay_cache/obs/`) and sets the buffer
   length (`max_time`/`max_replay`), then `StartReplayBuffer` if it isn't running.
2. `captureClip()` calls `SaveReplayBuffer` — **OBS auto-saves the current buffer to the
   set path** — then waits for the file. The exact path is learned 3 ways (in order):
   the `ReplayBufferSaved` WebSocket event (`savedReplayPath`), the
   `GetLastReplayBufferReplay` request, and a watch on the save directory.
3. `clips.trimLastSeconds()` trims the saved buffer to the configured pre/post-roll window
   (fast `-sseof` + `-c copy`, no re-encode; disabled with `trimToWindow: false`).
4. `clips.adoptFile()` moves it into the clip library as `replay-001-<type>.mp4/.mkv` and
   returns a clipInfo descriptor (`{id: "replay-001", title, type, team, duration, filePath, …}`).

**b) Synthetic fallback (`captureSource: "synthetic"`, simulator mode, or any OBS failure).**
`generateClip(options)` synthesises a broadcast-ready clip with FFmpeg: 1920×1080 @ 30 fps
labelled with `● REPLAY BUFFER — <TEAM> <TYPE>`, a live timecode and a BOS footer, plus a
440 Hz tone bed (AAC), written straight to `replay_cache/clips/`.

`listClips()` / `deleteClip()` fill the dashboard's "clips shelf" (`.mp4` and `.mkv` are
both supported, since OBS replay buffers commonly save `.mkv`).

**Clip metadata index.** Every clip also stores its **real metadata** — title, team, type,
camera view, camera id and exact duration — in a sidecar `replay_cache/clips/index.json`.
`listClips()` merges the index back into each listing, so the dashboard shows real durations
(no more hard-coded 8 s countdowns that cut replays short) and 📷 camera tags.

**c) Multi-camera capture (per camera view).** `CameraManager` (`cameras.js`) runs one
independent FFmpeg rolling buffer per entry in `replay.captureSources` (type `ffmpeg`):
each camera's segments live in `replay_cache/cameras/<id>/segments`, and at capture time
`assembleClipFromSegments()` concats the newest stable segments (re-encoded so boundaries are
safe), trims them to the pre/post-roll window, and `adoptFile()` moves a per-camera clip into
the shared library (`replay-004-cam1-goal.mp4`, tagged with the camera). The adopted
duration is capped to footage actually available, so a fresh camera never yields an
over-long clip. `input: "synthetic"` gives a labelled test pattern; anything else is passed
straight to FFmpeg (`rtsp://…`, `v4l2:/dev/video0`, `dshow://…`).

### 11.4 Slow motion (`slowmotion.js`)

- `processSlowMotion(input, speed)` runs FFmpeg with `setpts=<1/speed>*PTS` (video) and
  chained `atempo` (audio: `atempo=0.5` for ½×, `atempo=0.5,atempo=0.5` for ¼×), so the slow-mo
  is a real processed file — exactly what the spec means by "FFmpeg processing rather than
  asking OBS to play a video slower". Outputs are cached (`_slow_05x.mp4` / `_slow_025x.mp4`)
  and it falls back to the original file if FFmpeg fails.

### 11.5 ReplayEngine (`engine.js`) — the coordinator

`createReplayClip(options)` **routes capture**: in `"obs"` mode (and OBS connected) it
delegates to `obsCapture.captureClip`; if that fails — or in simulator/synthetic mode — it
falls back to `clips.generateClip`, so a replay is always produced. Then it calls
`cameras.captureAll(options)` to pull a clip from **every configured camera source** at the
same moment, emitting a `clipCreated` event per extra camera clip.

`playReplay(clip, speed, autoReturnLive=true)` executes the on-air sequence:

1. Sets temp state `REPLAY` (or `SLOW_MOTION` for speed < 1) on the match engine.
2. If slow-mo, processes the file first (actual duration becomes `duration / speed`).
3. Fires the custom **"REPLAY" transition** graphic, waits for screen coverage.
4. Shows the **replay overlay** graphic (title + speed badge + camera view when present).
5. `setMediaSourceFile` → loads the clip into the OBS Media Source.
6. `switchToReplay()` → the REPLAY scene goes to program.
7. `playMedia()` → the clip starts.
8. A 1-second countdown timer (initialised from the full clip duration) drives the
   "REMAINING" readout and, at zero, calls `stopReplay()` (if `autoReturnLive`).
9. `stopReplay()` reverses it: custom "LIVE" transition → stop media → hide overlay →
   switch back to the LIVE scene → reset temp state to `NONE`.

`getStatus()` reports playback state, capture source (`captureSource`), OBS replay-buffer
status (`obsReplayBuffer`), per-camera recorder status (`cameras`), a `lastMediaNote`
diagnostic (file + which OBS step succeeded/failed), buffer window, recorder status and all
saved clips.

### 11.6 Clip sequence manager (`sequence.js`) — cycling through clips

`ClipSequenceManager` is an operator-arranged **on-air playlist** built from the saved clip
library:

- **Editing** — `add(entry)` appends a clip (a duplicate just points the cursor at it),
  `move(from, to)` reorders, `setSpeed(i, speed)` sets per-clip playback speed (1× / ½× / ¼×),
  `removeAt(i)` / `clear()` prune. The whole order + flags persist to `config/bos.json`
  (`replay.sequence`, `replay.sequenceLoop`, `replay.sequenceAutoAdvance`), so the sequence
  survives restarts; entries pointing at deleted files are pruned automatically
  (`_pruneMissing` / `pruneFile`, the latter wired into `replay:deleteClip`).
- **Cycling** — `playNext()` / `playPrevious()` move a cursor through the list with
  wrap-around (LOOP), and `playIndex(i)` jumps straight to a clip. The Replay panel shows a
  **CLIP SEQUENCE CYCLER** strip (PREV / position / PLAY NEXT + clickable chips), hotkeys
  `[` / `]`, and the Settings → **Clip Sequence** tab provides the full editor.
- **AUTO-NEXT** — when a sequence clip finishes *naturally* (the ReplayEngine emits the new
  `playbackCompleted` event — never on manual STOP or emergency abort), the manager
  automatically plays the following clip. A playback-*generation* counter in the replay
  engine prevents the old clip's auto-return-to-LIVE from clobbering the next clip's start.

---

## 12. The Automated Goal Workflow (`electron/match/goalWorkflow.js`)

Pressing **GARNET GOAL** / **TOPAZ GOAL** (button or hotkey) calls `triggerGoal(teamKey, opts)`.
This is the heart of the system — it turns one press into the full broadcast sequence.
Concurrently with the animation, the replay clip is already being prepared (spec §25).

```text
  button / hotkey 'G' or 'T'
        │
        ▼
 1. canStartSequence? ── no? refused (conflict guard) ──┐
        │ yes                                          │
        ▼ (temp state → GOAL)                           ▼ force=true overrides
 2. Record GOAL event (team, match clock, timestamp)    │
 3. Queue 'flip' score animation → score +1             │
 4. ▶ start replay-clip generation IN THE BACKGROUND    │
 5. Goal animation graphic (team name, score, player)   │  (config: showGoalAnimation)
 6. Celebration hold (default 3.0 s)                    │  (celebrationDurationSeconds)
 7. Await background clip (so nothing waits needlessly) │
 8. Replay 1×  ──► transition → REPLAY scene → play     │  (playReplay1x)
 9. Replay ½×  ──► FFmpeg slow-mo pass, play again      │  (playSlowMo05x)
10. Return to LIVE ──► transition back, temp state NONE │
        ▼
   workflow completed
```

Details that matter:

- **Cancellation/abort** — `abort()` (the RETURN-TO-LIVE button, `L` hotkey, or the sequence
  bar) stops any replay, switches back to LIVE, and clears the temp state. The delay loops
  check `isAborted` every 50 ms, so the sequence responds almost instantly.
- **Overrides** — a second automated goal during a running sequence is refused unless the
  operator passes `force` (deliberate override, per spec §8).
- **Configurable** — every phase (animation on/off, celebration length, 1× / ½× on/off,
  auto-return) comes from `goalWorkflow.*` in `config/bos.json`, so the default flow can be
  re-shaped without touching code.
- **Event trail** — each goal is recorded in the event log with the match clock time, which
  the pre/post-roll replay window is built around.

---

## 13. Broadcast Sequences & Transitions

BOS orchestrates two transition *worlds*:

- **OBS transitions** (`transitions.js`) — Cut/Fade/Swipe/Stinger between scenes. Plain and
  reliable, used for scene changes.
- **Custom graphical transitions** (`graphics/transitions/`) — full-screen HTML/CSS/JS
  animations (sliding panels, logo, team colours) that *cover* the transition moment so the
  underlying OBS change is hidden. §13.5 describes the lifecycle.

### 13.1 Goal sequence
LIVE → goal animation + celebration → custom transition → REPLAY (1×, then ½× slow-mo) →
custom transition → LIVE. (Full detail in §12.)

### 13.2 Manual replay
Operator sets pre-roll / post-roll / speed (default 8 s / 7 s / 1×) in the Replay panel and
hits **CREATE REPLAY**. BOS generates the clip, then plays it to air via the same replay
path as §11.5 — including a manual IN/OUT selection on the timeline scrubber to adjust the
window before generating.

### 13.3 Lower thirds & status banners
`graphics:showLowerThird({title, subtitle, duration, position, style, animation})` shows a
lower third or F1-style banner over the live pictures. Presets ship for UNDER REVIEW,
GOAL CHECK, DECISION CONFIRMED, NO GOAL, MATCH DELAYED, MATCH RESUMING SHORTLY, TECHNICAL
DIFFICULTY and HALF TIME — but the operator can type anything (§20 spec). A duration (default
5 s) auto-hides it, and the **graphics queue** (`messages.js`) chains items: the next queued
message appears 500 ms after the current one hides.

### 13.4 Replay overlay
While a replay plays, the persistent REPLAY badge + speed + progress bar is shown by the
replay graphic (`graphics/replay/`), driven by `REPLAY_OVERLAY_SHOW/HIDE`.

### 13.5 Custom transition lifecycle (Addendum §7–9, §22–23)
The graphical transition implements a `start → covered → finished` handshake:

```text
BOS                          TRANSITION GRAPHIC
 │ transition.start()  ─────►  wipe panels slide in
 │                              │ 500 ms (full coverage)
 │  waits for coverage  ◄─────── TRANSITION_COVERED   ──► safe to switch OBS scene here
 │  switches OBS scene   ──►  OBS SetCurrentProgramScene
 │  starts replay / next    │ 1100 ms (wipe done)
 │  state                    └──► TRANSITION_FINISHED → panels hidden
```

Each transition gets a unique `id` so events can be matched. In v1.0 the engine fires the
transition and waits a fixed 500 ms before switching scenes (deliberate simplification —
the `COVERED/FINISHED` events are emitted by the graphic and received by the engine but not
yet awaited; see §21).

---

## 14. Broadcast Packages (`electron/graphics/packages.js` + `packages/`)

The Addendum (§18–25) calls for *pluggable broadcast design packages* — a whole look
(scoreboard, goal animation, lower thirds, transitions, fonts, colours) that can be swapped
without touching BOS logic. This version provides:

- `PackageManager` — lists packages (`listPackages()`, with `default` = built-in `graphics/`),
  stores the active choice in config (`graphics.activePackage`), and resolves graphic files
  against the selected package first, falling back to the built-ins
  (`resolveGraphicFile(graphicType, file)`).
- `packages/ssl_media_2026/` — an example package carrying a manifest (display name, colours,
  font, and per-graphic entry points).

> **Status:** the manager is implemented, but the graphics HTTP server still serves directly
> from the built-in `graphics/` folder, so package *switching* is not yet wired end-to-end.
> Running BOS with custom packages is a planned enhancement (see §21).

---

## 15. The Renderer Dashboard (`renderer/`)

The dashboard is plain HTML/CSS/JS, loaded into the Electron window. It is organised as:

| Area | Module | Contents |
| :--- | :--- | :--- |
| **Master header** | `app.js` | Program badge (PROGRAM: LIVE/GOAL/REPLAY), current scene pill, transition pill, match clock + period, **OBS ● CONNECTED / DISCONNECTED / SIMULATOR** + latency, RETURN-TO-LIVE emergency button, settings button |
| **Match panel** | `match.js` | Dedicated GARNET/TOPAZ goal buttons, +/− score buttons, match state dropdown, period dropdown, stoppage-time buttons, reset clock, scrolling event feed |
| **Replay panel** | `replay.js` | Buffer status (+ capture mode), OBS Replay Buffer status strip, **CLIP SEQUENCE CYCLER** (PREV/position/NEXT, chips with 📷 camera tags, LOOP/AUTO toggles), active replay card (name, speed, countdown, STOP), manual replay form (pre/post-roll, speed), timeline scrubber with IN/OUT selection, clips shelf (AIR 1×, AIR ½×, SEQ ＋, delete — showing real duration + camera tags) |
| **Graphics panel** | `graphics.js` | Lower-third form (title / subtitle / duration / position / style), SHOW / HIDE, message presets, on-air countdown card, graphics queue with remove buttons |
| **Settings modal** | `settings.js` | Tabs for OBS connection (+ capture source), scene names, team names/colours, goal-workflow toggles, **Clip Sequence** (add/reorder/remove clips, per-clip speed slow-mo, camera tags, loop & auto-advance) and (read-only) hotkey list; **SAVE** persists to `config/bos.json` |
| **Sequence bar** | `app.js` | While a goal workflow runs: shows the team, the current step, and SKIP/ABORT |

The UI never performs privileged work — every action is one `window.bosAPI.*` call, and every
state change arrives back through the event listeners registered in `app.js` (see §5.2).

---

## 16. Configuration Reference (`config/bos.json`)

| Key | Purpose | Default |
| :--- | :--- | :--- |
| `obs.host` / `obs.port` / `obs.password` | OBS WebSocket endpoint (OBS v5 server, port 4455) | `localhost` / `4455` / *(blank)* |
| `obs.autoReconnect` / `obs.reconnectIntervalMs` | Reconnection behaviour | `true` / `3000` |
| `teams.home` / `teams.away` | Name, shorthand, colours, logo, **score** (persisted live) | GARNET / TOPAZ |
| `scenes.liveScene` / `scenes.replayScene` / `scenes.graphicsScene` | Scene names BOS switches to | `LIVE` / `REPLAY` / `GRAPHICS` |
| `scenes.replayMediaSource` | OBS Media Source that plays replay clips | `Replay Video` |
| `replay.bufferSeconds` | Rolling buffer length (60–300 s) | `180` |
| `replay.preRollSeconds` / `replay.postRollSeconds` | Goal replay window before/after the event | `8` / `7` |
| `replay.defaultSpeed` / `replay.autoReplay` | Replay defaults | `1.0` / `true` |
| `replay.fps` / `replay.resolution` | Synthetic recorder quality | `30` / `1920x1080` |
| `replay.replayDirectory` | Where segments/clips are stored | `./replay_cache` |
| `replay.captureSource` | Capture mode: `obs` (OBS Replay Buffer over WebSocket — real footage) or `synthetic` (FFmpeg test pattern) | `obs` |
| `replay.obsReplayBuffer.savePath` | **Auto-save path** where OBS writes replay clips | `./replay_cache/obs` |
| `replay.obsReplayBuffer.maxBufferSeconds` | How much footage OBS keeps buffered (`max_time`) | `180` |
| `replay.obsReplayBuffer.maxReplays` | Number of replay files OBS keeps (`max_replay`) | `1` |
| `replay.obsReplayBuffer.trimToWindow` | Trim each saved clip to the pre/post-roll window (`-sseof` copy trim) | `true` |
| `replay.obsReplayBuffer.saveTimeoutMs` | Max wait for the saved clip file before falling back | `15000` |
| `replay.sequence` | Ordered clip sequence (playlist) — entries hold `filePath`, `title`, `type`, `speed`… | `[]` |
| `replay.sequenceLoop` | Wrap around when cycling past the end of the sequence | `true` |
| `replay.sequenceAutoAdvance` | Auto-play the next clip when the current one finishes naturally | `false` |
| `replay.captureSources` | Per-camera capture sources — `main` (type `obs`) + FFmpeg cameras (`{id, name, type, input, label, enabled}`); one rolling buffer + saved clip per camera view | `main` + cam1/cam2 examples |
| `graphics.httpPort` / `graphics.wsPort` | Graphics server ports | `8088` |
| `graphics.defaultLowerThirdDuration` / `graphics.animationStyle` | Lower-third defaults | `5` / `slide-in` |
| `transitions.defaultTransition` / `transitions.durationMs` | OBS transition defaults | `Fade` / `300` |
| `hotkeys.*` | Hotkey map (`KeyG`, `KeyT`, `KeyR`, `KeyL`, `KeyU`, `KeyH`, `Space`) | *(see §17)* |
| `goalWorkflow.*` | Animation on/off, durations, 1×/½× replays, auto-return | *(see §12)* |

---

## 17. Keyboard Shortcuts

Registered in `renderer/js/app.js` (configurable in `config/bos.json → hotkeys`; the key
bindings currently mirror the config defaults):

| Action | Key | Notes |
| :--- | :--- | :--- |
| Garnet Goal | `G` | Runs the full automated goal sequence |
| Topaz Goal | `T` | Runs the full automated goal sequence |
| Quick Replay | `R` | Creates a manual replay with the current pre/post-roll values and plays it |
| Return to Live (Emergency Abort) | `L` | Aborts workflow/replay, hides graphics, switches LIVE |
| Under Review | `U` | Shows the UNDER REVIEW / DECISION PENDING lower third |
| Hide Lower Third | `H` | Clears the active lower third |
| Start / Pause Match Clock | `Space` | Toggles the official match clock |
| Previous Clip in Sequence | `[` | `sequence.playPrevious()` — cycle back through the clips |
| Next Clip in Sequence | `]` | `sequence.playNext()` — cycle forward through the clips |

Hotkeys are ignored while the focus is inside an input/textarea/select, so typing in the
message box never triggers a broadcast action.

---

## 18. Recommended OBS Setup

The scene architecture from the spec (§5) is exactly what BOS expects — just three scenes:

```text
LIVE scene                REPLAY scene
├── Camera 1              ├── Replay Video      (Media Source named "Replay Video" —
└── Browser Sources:      │                       this is scenes.replayMediaSource)
    ├── Score Bug         └── Browser Sources:
    ├── Lower Third           ├── Replay Watermark
    ├── Goal Celebration      └── Transition Wipe
    └── Transition Wipe
```

Add Browser Sources pointing at the graphics server (`http://localhost:8088`), each
1920×1080 with a **transparent background** (chroma: transparent). Then enable OBS
**Tools → WebSocket Server Settings** on port 4455. BOS connects automatically; without OBS
running it uses Simulator mode (§9.4). Because BOS sends data over WebSocket, the Browser
Sources stay in sync even after you restart OBS or BOS.

For **OBS Replay Buffer capture** (§11.3a) also enable **Settings → Output → Replay Buffer →
Enable Replay Buffer** in OBS. BOS starts it automatically on first use and saves clips to
`replay.obsReplayBuffer.savePath`; the Replay panel shows the live buffer status.

---

## 19. Safety & Concurrency Model

The system is designed so a single mistaken click cannot wreck the broadcast:

- **Renderer isolation** — the dashboard can only issue whitelisted IPC calls; it cannot
  touch the filesystem, spawn processes, or connect to OBS directly.
- **Sequence conflict guard** — `MatchEngine.canStartSequence()` refuses a second automated
  sequence while one is active unless explicitly overridden (`force`).
- **Emergency abort** — `system:emergencyAbort` (button or `L`) stops replay, aborts the
  workflow, hides any lower third, and returns to LIVE in one call.
- **Abort-aware delays** — every workflow wait polls `isAborted`, so abort is near-instant
  (< 100 ms), even mid-celebration or mid-replay.
- **Graceful degradation** — no OBS? Simulator mode. No FFmpeg? Slow-mo falls back to the
  normal-speed file rather than failing the sequence. On quit, subprocesses and sockets are
  torn down cleanly.

---

## 20. Running & Testing

| Command | What it does |
| :--- | :--- |
| `npm start` | Launch BOS with the Electron window |
| `npm run dev` | Launch with DevTools available |
| `npm test` | `test.js` — instantiates every backend module (config → match → OBS (mock) → graphics server → replay recorder → goal workflow) and prints a validation summary |

The smoke test spins up the graphics server on port 8088 and the FFmpeg rolling buffer, then
tears everything down — a quick "does the whole backend wire up?" check. For full manual
testing, launch BOS without OBS running: everything except actual OBS output is simulated,
including the graphics server (open `http://localhost:8088/` in a browser to preview fonts,
transitions and animations).

---

## 21. Known Limitations & Next Steps

These are the gaps between this implementation and the written spec, in priority order:

1. **Broadcast packages not wired end-to-end** — `PackageManager` exists but the HTTP server
   serves the built-in `graphics/` only; `packages/ssl_media_2026/` is manifest-only.
   Wiring `resolveGraphicFile()` into the server would complete the "platform" story.
2. **Hotkeys not truly editable** — the default map lives in config, but the renderer
   hard-codes the key bindings and the Settings tab is read-only.
3. **Timeline IN/OUT visual only** — the scrubber sets an in/out window visually, but manual
   replay generation still uses the numeric pre/post-roll values.
4. **Transition events not awaited** — the graphic emits `TRANSITION_COVERED/FINISHED`, but
   the replay engine waits a fixed 500 ms instead of awaiting `COVERED`; timing would be
   perfectly robust if it consumed those events.
5. **Event-time input (spec §15)** — the manual replay form has no explicit wall-clock event
   time field; replays are built around the current moment plus pre/post-roll.
6. **Replay identifiers (partial)** — OBS-captured clips now get sequential
   `replay-001` ids, but synthetic fallback clips still use `clip_<timestamp>`, and replay
   graphics carry no camera-identifier field yet (multi-angle is reserved for the future).

---

*End of implementation reference. See `spec.md` for the original requirements and `addon.md`
for the graphics/animation requirements.*