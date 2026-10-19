# BOS Implementation Reference

This document describes the behavior implemented in this repository. It is intended to be a practical guide to the runtime architecture, operator workflows, configuration, OBS setup, and current limitations. The source code is authoritative if behavior changes.

BOS is an Electron control application for OBS Studio. It manages the match clock and score, can trigger Source Record replay-buffer saves, sends graphics to OBS Browser Sources, and coordinates a cancelable goal sequence. Goal sequences do not switch scenes automatically. BOS does not capture, edit, or play replay video itself.

## 1. Runtime Overview

```text
Electron main process
  ConfigManager ─ MatchEngine / ScoreManager / EventLogger
  OBSClient ─ ScenesController / SourcesController / TransitionsController
  GraphicsEngine (HTTP + WebSocket, default port 8088)
  ReplayEngine (OBS Source Record hotkey triggers)
  GoalWorkflowManager
          │
          ├── Electron IPC through preload.js
          ▼
Electron renderer dashboard
          │
          ├── OBS WebSocket v5 (through main process, default port 4455)
          └── OBS Browser Sources (HTTP + WebSocket through GraphicsEngine)
```

The main process owns application state and privileged operations. The renderer uses `window.bosAPI` from `electron/preload.js`; it does not import Node or Electron APIs directly. OBS remains responsible for scene composition and program output. Browser Sources render the scorebug, banners, transition, goal graphic, replay overlay, and optional top message.

Replay capture is different from replay airing: BOS asks OBS to trigger a Source Record hotkey. Source Record owns the replay buffers and writes the recordings. BOS does not locate, trim, load, or play those saved files.

## 2. Repository Layout

```text
config/bos.json                 Operator configuration

electron/main.js                Application lifecycle and dependency wiring
electron/config.js              ConfigManager
electron/preload.js             Secure renderer API
electron/ipc/handlers.js         IPC handlers and event forwarding
electron/obs/client.js          OBS WebSocket connection and requests
electron/obs/scenes.js          Scene enumeration and switching
electron/obs/sources.js         OBS media/browser-source helpers
electron/obs/transitions.js     OBS transition selection and duration
electron/match/engine.js        Match state and clock
electron/match/score.js         Team, score, branding, and goal-key state
electron/match/events.js        In-memory event log
electron/match/goalWorkflow.js  Automated goal sequence
electron/replay/engine.js       Source Record hotkey capture service
electron/graphics/engine.js     Graphics HTTP/WebSocket server and state

electron/graphics/score.js      Score/clock payload builder
electron/graphics/goal.js       Goal animation payload builder
electron/graphics/lowerThird.js Lower-third lifecycle and timer
electron/graphics/messages.js   Presets and lower-third queue
electron/graphics/packages.js  Package listing/resolution code

renderer/index.html             Operator dashboard and settings modal
renderer/css/main.css           Dashboard layout/theme
renderer/css/components.css     Dashboard component styles
renderer/js/app.js              OBS status, goal workflow banner, global hotkeys
renderer/js/match.js            Score, match, clock, team-branding controls
renderer/js/replay.js            Source Record capture status and camera buttons
renderer/js/graphics.js          Lower thirds, presets, and queue
renderer/js/settings.js          Settings form and persistence

graphics/score/                 Scorebug Browser Source
graphics/goal/                  Goal celebration Browser Source
graphics/lower-third/           Lower-third Browser Source
graphics/top-message/           Optional top-message Browser Source
graphics/replay/                Replay badge/overlay Browser Source
graphics/transitions/           Custom transition Browser Source
packages/ssl_media_2026/        Example broadcast package
```

There is no FFmpeg recorder, clip library, timeline, clip-sequence manager, or multi-angle video assembler in the current `electron/replay/` directory.

## 3. Startup and Shutdown

`electron/main.js` initializes the application in this order:

1. Load `ConfigManager` from `config/bos.json`.
2. Construct `ScoreManager`, `EventLogger`, and `MatchEngine`.
3. Construct `OBSClient` and the scene, source, and transition controllers.
4. Start `GraphicsEngine` and create `ReplayEngine` and `GoalWorkflowManager`.
5. Create the dashboard `BrowserWindow`, register IPC handlers, then attempt an OBS connection.

The window uses `contextIsolation: true` and `nodeIntegration: false`. If OBS is unavailable, BOS reports disconnected and retries when `obs.autoReconnect` is enabled. OBS-dependent calls fail while disconnected; there is no mock/simulator mode.

On quit, the app destroys the replay service, closes the graphics WebSocket/HTTP servers, clears the match clock interval, and disconnects OBS.

## 4. Configuration

`ConfigManager` reads and parses `config/bos.json`. If it cannot load that file, it creates in-code defaults. `get('a.b')` reads a dotted path, `set('a.b', value)` persists an individual value immediately, and `updateAll()` shallow-merges top-level sections and writes the result.

Score and team updates are persisted by `ScoreManager`. Match period labels, explicit clock start times, timer modes, and added-time mode are persisted by `MatchEngine`. Settings edits are saved through the Config tab in the dashboard.

### Main configuration groups

| Key | Purpose |
| :--- | :--- |
| `obs.host`, `obs.port`, `obs.password` | OBS WebSocket v5 connection. Defaults are `localhost:4455`; leave password blank if OBS authentication is disabled. |
| `obs.autoReconnect`, `obs.reconnectIntervalMs` | Reconnection behavior. |
| `teams.home`, `teams.away` | Each side's `name`, `short`, `color`, `secondaryColor`, `hotkey`, score, and optional logo. Scores and team data are persisted. |
| `scenes.liveScene`, `scenes.replayScene`, `scenes.graphicsScene` | Scene names used by the scene controller. |
| `scenes.replayMediaSource` | OBS Media Source name used by helper methods; replay airing is not currently wired to it. |
| `replay.enabled` | Enables/disables Source Record hotkey requests. |
| `replay.hotkeyName`, `replay.contextName` | Shared fallback values for OBS `TriggerHotkeyByName`. |
| `replay.captureSources` | Camera/source entries: `{id, name, enabled, hotkeyName, contextName}`. Blank per-source hotkey/context values inherit the shared fallback. |
| `goalWorkflow.showGoalAnimation`, `goalWorkflow.goalAnimationDuration` | Goal graphic visibility and duration. |
| `goalWorkflow.captureReplayOnGoal` | Whether a goal invokes replay capture. |
| `goalWorkflow.replaySourceId` | Blank captures every enabled camera in sequence; an ID captures only that source. |
| `goalWorkflow.celebrationDurationSeconds` | Goal celebration hold before the sequence waits for the operator. |
| `match.timerMode` | `stopwatch`, `countdown`, or `none` for no-time matches. |
| `match.offenseTimerSeconds`, `match.offenseSeconds` | Basketball offense-timer duration and current time in seconds; defaults to 24 seconds and is shown in the basketball controls and header. |
| `match.bestOfSets`, `match.completedSets` | Volleyball total sets and persisted manual set-winner results, including each set's points. |
| `match.regulationMinutes` | Main clock regulation/set duration in minutes. |
| `match.startSeconds` | Optional configured start/reset time in seconds, set from the `MM:SS` control. |
| `match.periodLabel` | Free-text period label, for example `Q1` or `First Half`. |
| `match.additionalTimeMode` | `automatic` or `approval`; approval mode waits for GO AHEAD at regulation. |
| `graphics.httpPort` | Graphics HTTP and WebSocket server port (default `8088`). WebSocket shares this port; `graphics.wsPort` is not bound separately. |
| `graphics.defaultLowerThirdDuration`, `graphics.animationStyle`, `graphics.lowerThirdColor` | Lower-third defaults. |
| `transitions.defaultTransition`, `transitions.durationMs` | OBS scene-transition defaults managed by `TransitionsController`. |

The checked-in configuration may contain operator-specific teams, scenes, or OBS connection settings. Do not copy credentials into documentation or share them publicly.

## 5. IPC and State Flow

The renderer can call only methods exposed by `contextBridge` in `electron/preload.js`. `electron/ipc/handlers.js` maps those methods to the main-process controllers.

| `window.bosAPI` group | Main responsibilities |
| :--- | :--- |
| `obs` | Connect/disconnect, status, scenes, scene switching, OBS transitions. |
| `match` | Match state; clock start/pause/toggle/reset; current/start time; timer and added-time modes; approval; period label. |
| `score` | Get/add/subtract/set/reset score and update team branding. |
| `events` | Read, record, and clear the event log. |
| `replay` | Read capture status, trigger one source, or trigger all enabled sources. `air()` is a placeholder. |
| `graphics` | Show/hide lower thirds and top messages, manage presets/queue, trigger goal/transition graphics, control scorebug visibility. |
| `workflow` | Trigger a goal, end the sequence, cancel it, and inspect workflow state. |
| `system` | Emergency return to LIVE. |
| `config` | Read/write configuration. |

Main-process events are forwarded back to the renderer, including OBS status/scene/ping, score and team changes, clock ticks/changes, match-state changes, event-log changes, replay request status, graphics queue updates, and goal-workflow lifecycle/step events.

## 6. OBS Integration

`OBSClient` wraps `obs-websocket-js` and connects to `ws://<host>:<port>`. It loads the current scene and available scene list after connecting, listens for scene/stream/record notifications, and pings OBS with `GetVersion` every five seconds. `call()` rejects if disconnected. Connection failures are shown in the dashboard; optional retry uses the configured interval.

- `ScenesController` enumerates scenes and switches to names from `scenes.*` with `SetCurrentProgramScene`.
- `TransitionsController` lists and selects OBS-native transitions and sets their duration.
- `SourcesController` includes helpers for setting/playing/stopping a Media Source, refreshing a Browser Source, and toggling scene-item visibility. Those media helpers are not part of the current Source Record replay capture workflow.

A failed scene switch returns `false` and is surfaced to the goal workflow. OBS scene names must match the configured names exactly.

## 7. Match Clock, Periods, and Added Time

`MatchEngine` is an `EventEmitter` with official match states (`PRE_MATCH`, `LIVE`, `HALF_TIME`, `LIVE_SECOND_HALF`, `FULL_TIME`, `BREAK`, `DELAYED`, `UNDER_REVIEW`) and temporary states (`NONE`, `GOAL`, `REPLAY`, `SLOW_MOTION`, `GRAPHIC_ACTIVE`). `canStartSequence()` prevents a second automated goal workflow from starting while another sequence is active unless `force` is passed.

The one-second clock supports:

- Stopwatch: counts up until `regulationMinutes`.
- Countdown: counts down to zero.
- Editable period label: arbitrary text is accepted and saved, such as `Q1`, `Set 1`, or `First Half`.
- Editable starting clock: renderer accepts `MM:SS`; `setStartTime(seconds)` updates the displayed value and the saved reset/start value.
- Reset, set, start, pause, and toggle controls.

When added minutes are selected, added time begins at regulation according to `match.additionalTimeMode`:

- `automatic`: starts immediately.
- `approval`: freezes the main clock at regulation and displays a GO AHEAD button. Regular start/space cannot bypass approval. Approval starts the separate added-time counter at `00:00`.

The added-time counter increments to the selected number of minutes and then stops. The previous automatic “N MINUTES ADDED ON” top banner is no longer generated. The scorebug continues to receive clock state through `CLOCK_UPDATE`.

## 8. Scores, Teams, and Events

`ScoreManager` owns home and away team records. Each record includes name, short name, primary/secondary colors, goal hotkey, score, and logo. Score changes clamp at zero, emit `scoreChanged`, persist the team objects, and cause a scorebug update. Team changes emit `teamsUpdated`, so updated names and colors are broadcast to graphics.

The Match Controls scoring selector chooses 1, 2, or 3 points. It applies to goal buttons and manual plus/minus adjustments. Automated goal options carry the selected points, and the `GOAL` event records that point value.

Team colors drive the operator goal buttons, team labels, goal animation, transition accent, and scorebug color bars. The Teams & Branding settings expose editable names, short names, colors, and goal keys. Palette presets assign G to Garnet, E to Emerald, and T to Topaz. A team with a custom name can use its own key; team hotkeys are stored as keyboard `code` strings (such as `KeyX` or `F1`). The operator UI displays the currently assigned key.

`EventLogger` stores up to 200 events in memory with an ID, timestamp, ISO time, display time, type, and event details. It is not a durable event database.

## 9. Automated Goal Workflow

`GoalWorkflowManager.triggerGoal(team, options)` coordinates this sequence:

1. Resolve the home/away team and selected points; check the sequence conflict guard.
2. Set temporary match state to `GOAL` and record a `GOAL` event with the clock, team, player, and points.
3. Increment the selected team’s score and request a score flip animation.
4. Optionally show the goal animation and wait `goalAnimationDuration`.
5. If enabled, trigger Source Record capture. With no `goalWorkflow.replaySourceId`, all enabled camera sources are triggered sequentially; with an ID, only that source is triggered. This saves footage but does not switch scenes.
6. Keep LIVE on air after the goal. The operator may choose **GO TO REPLAY** to switch to the configured REPLAY scene. **CANCEL SEQUENCE** remains available throughout and returns to LIVE; after opting into replay, **GO AHEAD → LIVE** returns to LIVE.

The workflow does not load or play saved camera files; it relies on the configured OBS REPLAY scene to present replay footage. Replay capture and switching to the replay scene are separate: capture follows its goal setting, while going to REPLAY always requires an operator action.

The custom transition Browser Source remains available for manually selected scene transitions.

## 10. Replay Capture: Source Record

`ReplayEngine` is a request service, not a video engine. It sends OBS WebSocket `TriggerHotkeyByName` with both `hotkeyName` and `contextName`. The default pair is `ReplayBuffer.Save` and the configured Source Record context. OBS accepting the request does not confirm that a file has finished writing.

Each `replay.captureSources` row has an ID, display name, enabled flag, and optional hotkey/context overrides. Empty overrides inherit the shared replay hotkey/context. Settings can add/remove camera rows, enable/disable each row, and edit the overrides.

- **SAVE ALL REPLAYS** triggers each enabled source in order, one request at a time.
- Each enabled source also has an individual SAVE button in the Replay panel.
- Goal capture follows the same all-enabled behavior unless `goalWorkflow.replaySourceId` selects one camera.
- If there are no enabled source rows, SAVE ALL falls back to the shared default hotkey.

Completed volleyball sets can be removed individually from the set-results list. Removing a result renumbers later sets and updates the series count; it does not restore the score from the removed set.
The live home/away sets-won tallies have separate +/− controls. Manual tally adjustments do not edit completed-set history, and counts cannot go below zero.
The best-of count can be changed at any time, including below the number of already completed sets. The main score reset also clears all completed set results. Awarding a set displays a “SET WON BY” lower third.
Home and away goal-button action labels are independently configurable (for example, “GOAL” or “POINT”). The goal graphic animation is silent.

Replay request state is `IDLE`, `TRIGGERING`, `TRIGGERED`, or `ERROR`. The UI briefly shows the result, returns to READY, and keeps the last-triggered timestamp. Capture status reflects request acceptance, not confirmed media-file creation.

`airReplay()` currently returns a not-implemented result. BOS does not locate, adopt, trim, or play the files saved by Source Record. `scenes.replayMediaSource` and the OBS media helpers are prepared for future airing integration but are not connected to this capture path.

## 11. Graphics Server and Browser Sources

`GraphicsEngine` starts an HTTP static server and WebSocket server on `graphics.httpPort` (default `8088`). Directory URLs resolve to `index.html`. Browser Sources connect to `ws://<host>:8088/ws`, receive `INITIAL_SYNC`, and reconnect after a dropped socket. The initial snapshot includes score/clock, set tally, offense timer, lower-third state, top-message state, replay-overlay state, and scorebug visibility.

### Browser Source URLs

| Graphic | URL path | Runtime behavior |
| :--- | :--- | :--- |
| Scorebug | `/graphics/score/` | Team labels/colors/scores, match clock and period, added-time counter, score animations, fade visibility. |
| Goal | `/graphics/goal/` | Team-colored goal animation, optional player/assist text, synthesized goal horn, timed hide. |
| Lower third | `/graphics/lower-third/` | Standard notice appearance, configurable position/accent color, auto-dismiss. |
| Top message | `/graphics/top-message/` | Optional top-position banner used through the top-message API; no longer selected by the standard message form. |
| Replay overlay | `/graphics/replay/` | Replay title/speed/progress display when replay overlay messages are sent. |
| Transition | `/graphics/transitions/` | Custom sliding wipe with title and optional team colors. |

The match operator panel exposes a link to `/remote/` using the machine's local network address and a persisted password (`graphics.remoteControlKey`), generated on first run and stored in `config/bos.json`. Change the password in the BOS panel; it must be at least 8 characters and is applied only when SAVE PASSWORD is clicked. Show/hide controls are available for the password in both BOS and the remote login. Browser remotes must authenticate against the current stored password, and changing it revokes existing remote sessions. The BOS panel owns the persisted immediate-score toggle (`graphics.remoteImmediateScore`), which defaults to off and syncs to connected remotes. With it off, remote score taps are submitted as requests and must be approved or rejected in the BOS operator panel; approval never happens on the browser remote. With it on, remote score changes apply immediately. The authenticated remote can also seek the current match clock, set the clock's configured start time, and change the period label. Match and offense timer controls always take effect immediately. The offense timer is included in the scorebug/browser remote during countdown (basketball) mode. In no-time mode, the scorebug and remote show the volleyball set tally instead of a `NO TIME` clock.

The lower-third quick messages include one TIMEOUT CALLED action per configured team. Each button identifies its team, while the on-air title remains `TIMEOUT CALLED` and the subtitle reads `TIMEOUT CALLED BY [team]`; the buttons refresh when team names change. Queue updates are sent to the dashboard immediately, and queued messages begin automatically when the lower third is idle or after the current message is dismissed.

### WebSocket messages

| Message | Direction | Purpose |
| :--- | :--- | :--- |
| `INITIAL_SYNC` | BOS → graphic | Initial score/clock/set tally and persistent graphic state. |
| `SCORE_UPDATE` | BOS → scorebug | Team scores/branding and animation type. |
| `CLOCK_UPDATE` | BOS → scorebug | Current clock/period/additional-time state. |
| `SETS_UPDATE` | BOS → scorebug | Updated volleyball set tally. |
| `OFFENSE_UPDATE` | BOS → scorebug/browser remote | Offense timer time and running state. |
| `REMOTE_AUTH` / `REMOTE_AUTH_RESULT` | browser remote ↔ BOS | Authenticate browser control access with the current persisted password. |
| `REMOTE_AUTH_REQUIRED` | BOS → authenticated browser remote | Password changed; re-authentication is required before further control. |
| `REMOTE_COMMAND` / `REMOTE_COMMAND_RESULT` | browser remote ↔ BOS | Authenticated score requests or immediate score changes and immediate timer actions and their result. |
| `REMOTE_SCORE_PROPOSALS` | BOS → browser remote / BOS renderer | Pending remote score requests for the BOS operator to approve or reject. |
| `SCOREBUG_VISIBILITY` | BOS → scorebug | Fade the scorebug in/out. Visibility resets to visible on BOS restart. |
| `GOAL_ANIMATION` | BOS → goal | Team, score, player/assist, animation duration. |
| `LOWER_THIRD_SHOW` / `LOWER_THIRD_HIDE` | BOS → lower third | Show/dismiss current lower third. |
| `TOP_MESSAGE_SHOW` / `TOP_MESSAGE_HIDE` | BOS → top message | Show/dismiss top-message banner through API. |
| `REPLAY_OVERLAY_SHOW` / `REPLAY_OVERLAY_HIDE` | BOS → replay | Replay overlay state. Replay capture itself does not currently play/emit a clip overlay. |
| `TRIGGER_TRANSITION` | BOS → transition | Start a custom wipe with ID/title/colors. |
| `TRANSITION_COVERED` / `TRANSITION_FINISHED` | transition → BOS | Report coverage and completion for transition graphics. |

Scorebug visibility is currently in-memory only and returns to visible at startup. Volleyball set winners are selected manually; awarding a set records the winner and point score, resets points for the next set, and updates the set tally. On-screen messages use duration `0` to remain until hidden; the lower-third and top-message sources omit the default broadcast badge.

## 12. Renderer Controls and Keyboard Shortcuts

The dashboard has three main work areas:

- **Match Controls:** match state, custom period label, regulation duration, starting clock, stopwatch/countdown/no-time modes, manual volleyball set winners and total sets, scoring value, team goal buttons, +/- controls, scorebug visibility, and event log.
- **On-Screen Message:** title/subtitle/highlight, finite or until-hidden duration, position, accent color, presets, active graphic status, and a queue.
- **Replay Capture:** shared SAVE ALL action, per-enabled-camera buttons, request state, and last-triggered time.

Settings tabs include OBS/scenes/Source Record camera trigger list, Teams & Branding, Goal Automation, and the hotkey reference. Team palette buttons apply colors/names and their standard G/E/T bind. Any team goal key can be edited in Teams & Branding.

Current default keyboard actions:

| Key | Action |
| :--- | :--- |
| Team-configured key | Trigger that team’s goal workflow (Garnet G, Emerald E, Topaz T by default). |
| `R` | Trigger SAVE ALL REPLAYS. |
| `L` | Emergency abort and direct return to LIVE. |
| `U` | Show UNDER REVIEW lower third. |
| `H` | Hide lower third. |
| `Space` | Start/pause the match clock, except while added-time approval is pending. |

Team goal hotkeys come from the team objects. The other shortcuts above are currently registered in `renderer/js/app.js`; the legacy `hotkeys` configuration block is not used to dynamically rebind them. Key shortcuts are ignored while an input, textarea, or select has focus.

## 13. OBS Setup

1. Enable OBS WebSocket v5 in OBS (default port `4455`) and enter the connection settings in BOS.
2. Create the configured LIVE and REPLAY scenes (default names `LIVE` and `REPLAY`).
3. Add Browser Sources for the needed graphics using `http://localhost:8088/graphics/<name>/`, normally at 1920×1080 with transparent background.
4. Include the same transition Browser Source in both LIVE and REPLAY, or place it in a shared scene included in both. This keeps it active across scene switches.
5. Configure Source Record’s replay buffer and hotkeys in OBS. Copy each hotkey name/context into the shared defaults or the matching camera row in BOS Settings.
6. If using multiple camera buffers, add and enable one capture-source row per camera. SAVE ALL and goal capture then issue one OBS request for each enabled row.

OBS still owns program composition, camera selection, Source Record buffering, and file output. BOS’s REPLAY scene switch alone does not guarantee that a saved replay file is being played.

## 14. Graphics Packages

`electron/graphics/packages.js` contains package listing and path-resolution helpers, and `packages/ssl_media_2026/` is an example package. The active HTTP server still serves built-in files from `graphics/`; package switching is not wired end-to-end.

## 15. Running and Testing

| Command | Behavior |
| :--- | :--- |
| `npm start` | Launch Electron. |
| `npm run dev` | Launch Electron in development mode. |
| `npm test` | Run `node test.js`, which instantiates backend modules and checks config, clock modes, start/period values, team keys, added-time approval, and multi-camera replay request payloads. |

The smoke test starts the GraphicsEngine on port `8088`. If another BOS instance already owns that port, the test server can fail to bind; close the other instance before running the full smoke test.

## 16. Current Limitations

- Replay capture sends hotkey requests only. BOS does not verify Source Record completed a file write, nor does it provide replay clip playback or file management. Goal-triggered capture is off by default.
- `ReplayEngine.airReplay()` is a placeholder.
- Goal sequences remain on the current scene and can be cancelled; scene changes and replay airing are operator-controlled.
- OBS has no simulated fallback. Scene changes, transitions, and replay hotkey requests require an active OBS WebSocket connection.
- Custom transition coordination relies on the transition Browser Source being connected; timeout fallbacks permit progress but cannot guarantee that a wipe was visible.
- The `autoReturnLive` goal config field is retained for compatibility but does not trigger automatic scene changes.
- Team goal binds are configurable per team. R/L/U/H/Space are currently fixed in the renderer rather than dynamically loaded from the legacy `hotkeys` block.
- The top-message graphic/API remains available, but the standard message form controls lower thirds only.
- Broadcast package path resolution exists but the HTTP server has not been wired to serve an active package.

---

*This guide documents the current source implementation. `spec.md` and `addon.md` describe broader requirements and ideas that may not yet be implemented.*
