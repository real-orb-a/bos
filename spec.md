BOS — Broadcast Operator System
Technical Specification — v1.0
1. System Overview
BOS (Broadcast Operator System) is a cross-platform desktop broadcast-control application built entirely around Node.js and Electron.
BOS provides the broadcast operator with a single interface for controlling:
- OBS
- Live broadcast scenes
- Match score
- Match clock/state
- Dynamic broadcast graphics
- Goal animations
- Goal celebrations
- Replay capture
- Replay playback
- Slow-motion replay
- Lower-third messages
- Review/status messages
- Broadcast transitions
- Match events
- Automated broadcast sequences
OBS remains the final video production and output engine.
BOS acts as the broadcast control and automation layer above OBS.
                         BOS
              Broadcast Operator System
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   Match Engine     Graphics Engine   Replay Engine
        │                │                │
        │                │                ▼
        │                │              FFmpeg
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
                  OBS WebSocket
                         │
                         ▼
                        OBS
                         │
                         ▼
                  Broadcast Output

2. Technology Requirements
Required
Component	Technology
Application	Electron
Runtime	Node.js
UI	HTML / CSS / JavaScript
OBS control	OBS WebSocket
Video processing	FFmpeg
Replay processing	FFmpeg + Node.js
IPC	Electron IPC
Graphics	HTML/CSS/JS Browser Sources
Configuration	JSON
Platform	Windows / macOS / Linux


BOS must not be implemented as a Windows-only application.
The core application must remain cross-platform.
3. Electron Architecture
Electron provides the desktop application window.
BOS
│
├── Electron Main Process
│   │
│   ├── OBS Controller
│   ├── Replay Engine
│   ├── FFmpeg Controller
│   ├── Match Engine
│   ├── Graphics Controller
│   ├── Configuration Manager
│   └── IPC Server
│
└── Electron Renderer
    │
    ├── Dashboard
    ├── Match Controls
    ├── Replay Controls
    ├── Graphics Controls
    ├── Event Controls
    └── Settings

The renderer must not directly execute system commands or communicate with OBS.
All privileged operations are performed by the Electron main process.
4. OBS Integration
BOS must communicate with OBS using OBS WebSocket.
The connection must support:
- Connection
- Disconnection
- Reconnection
- Authentication
- Scene switching
- Source visibility
- Source settings
- Text updates
- Browser source refresh
- Media source control
- Transition selection
- Transition duration
- Streaming status
- Recording status
The operator should be able to see:
OBS ● CONNECTED

or:
OBS ● DISCONNECTED

If OBS disconnects, BOS must attempt automatic reconnection.
5. OBS Scene Architecture
BOS should not require dozens of scenes.
A basic configuration could contain:
LIVE
REPLAY
GRAPHICS

with graphics being dynamically controlled inside those scenes.
For example:
LIVE
├── Camera
├── Score Graphic
├── Lower Third
└── Broadcast Overlay

REPLAY
├── Replay Video
├── Replay Graphic
└── Optional Replay Branding

BOS should be able to work with a configurable OBS scene structure rather than hard-coding scene names.
6. Dynamic Score System
The score is maintained by BOS.
Example:
GARNET     2
TOPAZ      1

The operator can:
+ Garnet
- Garnet

+ Topaz
- Topaz

The score graphic automatically updates.
The score must not require the operator to manually edit OBS text sources.
7. Score Graphics
The score graphic should be implemented as an HTML/CSS/JavaScript Browser Source.
Example:
┌─────────────────────────────┐
│ GARNET              TOPAZ   │
│   2                   1     │
└─────────────────────────────┘

BOS sends the current match data to the graphics system.
The graphic can animate:
1 → 2

instead of simply changing instantly.
The animation style must be configurable.
8. Match Engine
BOS maintains the official broadcast match state.
Possible states:
PRE_MATCH
LIVE
HALF_TIME
LIVE_SECOND_HALF
FULL_TIME
BREAK
DELAYED
UNDER_REVIEW

Additional temporary states may include:
GOAL
REPLAY
SLOW_MOTION
GRAPHIC_ACTIVE

The system must prevent conflicting automated sequences.
For example, if a replay is currently playing, another automated goal sequence should not unexpectedly interrupt it unless the operator explicitly chooses to override it.
9. Goal System
The operator dashboard must contain dedicated goal buttons.
┌─────────────────────────────┐
│          GOAL               │
│                             │
│   [ GARNET GOAL ]           │
│   [ TOPAZ GOAL ]            │
└─────────────────────────────┘

When pressed:
1. BOS records the goal event.
2. BOS records the event timestamp.
3. BOS updates the score.
4. BOS updates the score graphic.
5. BOS triggers the goal animation.
6. BOS triggers the configured celebration.
7. BOS prepares the replay.
8. BOS plays the replay.
9. Optional slow motion is played.
10. BOS returns to live.
10. Goal Animation
Goal animations must be configurable broadcast graphics.
Example:
GARNET
GOAL!

The animation may contain:
- Team name
- Team logo
- Updated score
- Match information
- Animated background
- Sound effect
- Team branding
The animation should be capable of being implemented as:
- HTML/CSS animation
- Transparent video
- Browser Source animation
- Combination of sources
The BOS engine must not depend on one specific animation implementation.
11. Goal Celebration
A goal sequence can contain a celebration period.
Example:
GOAL
 ↓
Goal Animation
 ↓
Celebration
 ↓
Replay
 ↓
Slow Motion
 ↓
LIVE

The celebration duration must be configurable.
Example:
Celebration duration:
[ 3.0 ] seconds

The operator must also be able to skip it.
12. Replay System
BOS must maintain a configurable rolling replay buffer.
Default:
180 seconds

The system must support at least:
60 seconds
90 seconds
120 seconds
180 seconds
300 seconds

The replay engine continuously records/captures the available broadcast/camera footage.
The rolling buffer must continue while:
- Live
- Goal animation is playing
- Replay is playing
- Slow motion is playing
13. Replay Event Capture
When a goal occurs:
Event:
15:32:18

BOS uses:
Pre-roll: 8 seconds
Post-roll: 7 seconds

Result:
15:32:10 ─────────────────── 15:32:25
      ↑             ↑              ↑
    START          GOAL           END

The pre-roll and post-roll values must be configurable.
14. Replay Configuration
Example:
REPLAY SETTINGS

Buffer:
[ 180 ] seconds

Default pre-roll:
[ 8 ] seconds

Default post-roll:
[ 7 ] seconds

Default playback:
[ 1× ]

Auto replay:
[ Enabled ]

The operator should be able to modify the replay values before generating a replay.
15. Manual Replay
The operator must be able to create a replay independently of a goal.
Example:
REPLAY

Event time:
[ 15:32:18 ]

Before:
[ 10 ] seconds

After:
[ 12 ] seconds

Speed:
[ 1× ]

[ CREATE REPLAY ]

This allows the operator to replay:
- Goals
- Saves
- Fouls
- Important plays
- Near misses
- Other events
16. Replay Playback
OBS will display the replay through a configured Media Source.
BOS:
Generate replay
      ↓
Replay file
      ↓
Set OBS Media Source
      ↓
Switch to Replay Scene
      ↓
Play media
      ↓
Return to Live

OBS therefore remains responsible for the actual program output.
17. Slow Motion
BOS must support:
1×
½×
¼×

The architecture should permit additional speeds later.
For high-quality slow motion, BOS should use FFmpeg processing rather than simply asking OBS to play a video slower.
Possible future enhancement:
Normal footage
      ↓
Frame interpolation
      ↓
Higher-frame-rate output
      ↓
Slow-motion replay

This can produce significantly smoother slow motion.
18. Replay Timeline
The operator should have a timeline view.
Example:
REPLAY TIMELINE

15:29        15:30        15:31        15:32
───────────────────────────────────────────────
                                  ▲
                                EVENT

The operator can select an event point and define:
IN
OUT

The replay engine then generates the requested clip.
19. Lower-Third Graphics System
This is where the UNDER REVIEW functionality belongs.
It should not be a dedicated full-screen scene.
Instead, BOS controls a dynamic lower-third graphic.
For example:
────────────────────────────────────────────────────────

                    LIVE MATCH

────────────────────────────────────────────────────────
     UNDER REVIEW
     DECISION PENDING
────────────────────────────────────────────────────────

The graphic can appear over the live camera feed.
It could be positioned along the bottom of the screen, similar to professional sports broadcasts.
20. Dynamic Broadcast Message
The operator should be able to enter any message.
Example:
BROADCAST MESSAGE

Message:
┌────────────────────────────────────┐
│ UNDER REVIEW                       │
└────────────────────────────────────┘

[ SHOW ]

Other examples:
UNDER REVIEW

GOAL CHECK

DECISION PENDING

MATCH DELAYED

MATCH RESUMING SHORTLY

TECHNICAL DIFFICULTY

HALF TIME

The system must not restrict the operator to predefined messages.
21. Lower-Third Message Configuration
The operator should have controls for:
Message
Title
Subtitle
Duration
Position
Animation

Example:
┌───────────────────────────────────────┐
│ MESSAGE                               │
│                                       │
│ Title:    UNDER REVIEW                │
│ Subtitle: DECISION PENDING            │
│                                       │
│ Duration: [ 5 ] seconds               │
│                                       │
│ Animation: [ Slide In ]               │
│                                       │
│ [ SHOW ]             [ HIDE ]         │
└───────────────────────────────────────┘

The lower third can therefore look like:
┌───────────────────────────────────────────────────┐
│                                                   │
│                 LIVE CAMERA                       │
│                                                   │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ UNDER REVIEW                                │  │
│  │ DECISION PENDING                            │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
└───────────────────────────────────────────────────┘

22. F1-Style Status Graphics
The graphics engine should support broadcast status banners.
These are short-lived graphic elements that can appear without taking over the whole screen.
For example:
┌────────────────────────────────────────────┐
│ UNDER REVIEW                               │
└────────────────────────────────────────────┘

Then:
┌────────────────────────────────────────────┐
│ DECISION CONFIRMED                         │
└────────────────────────────────────────────┘

Or:
┌────────────────────────────────────────────┐
│ NO GOAL                                    │
└────────────────────────────────────────────┘

These are simply examples; the operator can enter whatever text is needed.
23. Graphics Queue
BOS should maintain a small graphics queue.
Example:
ACTIVE GRAPHICS

● UNDER REVIEW
  00:04 remaining

QUEUED

1. GOAL CONFIRMED
2. REPLAY

The operator can remove or cancel queued graphics.
24. Automated Goal Workflow
Default workflow:
                 GOAL BUTTON
                      │
                      ▼
                Record Event
                      │
                      ▼
                 Update Score
                      │
                      ▼
               Update Graphic
                      │
                      ▼
                Goal Animation
                      │
                      ▼
                  Celebration
                      │
                      ▼
               Generate Replay
                      │
                      ▼
                 Replay 1×
                      │
                      ▼
               Replay ½×
                      │
                      ▼
                   LIVE

The workflow should be configurable.
25. Replay During Goal Animation
The replay engine must begin preparing the replay immediately after the goal event is recorded.
This means:
Goal occurs
    │
    ├──────────────► Goal animation
    │
    └──────────────► Replay preparation

Both processes happen concurrently.
This prevents unnecessary waiting.
26. Live Output
BOS should always display the current broadcast state.
Example:
PROGRAM

● LIVE

Scene:
LIVE

Transition:
Fade

Replay:
Ready

OBS:
● Connected

During replay:
PROGRAM

● REPLAY

Replay:
Garnet Goal

Speed:
½×

Remaining:
00:07

27. Operator Safety
Large/high-impact controls should require deliberate interaction.
Examples:
GARNET GOAL
TOPAZ GOAL
RETURN TO LIVE
STOP REPLAY

The interface should avoid accidental activation where practical.
However, goal controls should still be fast enough for live operation.
28. Keyboard Shortcuts
BOS should support configurable hotkeys.
Example:
Garnet Goal       G
Topaz Goal        T
Replay            R
Return Live       L
Under Review      U
Hide Lower Third  H

The operator can change these.
29. Configuration System
All broadcast configuration should be stored outside application source code.
Example:
config/
    bos.json

Configuration includes:
OBS connection
Team names
Team branding
Scene names
Source names
Replay settings
Graphics settings
Transitions
Hotkeys
Goal workflow
Default durations

30. Project Structure
Recommended structure:
bos/
│
├── package.json
├── electron/
│   ├── main.js
│   ├── preload.js
│   │
│   ├── obs/
│   │   ├── client.js
│   │   ├── scenes.js
│   │   ├── sources.js
│   │   └── transitions.js
│   │
│   ├── match/
│   │   ├── engine.js
│   │   ├── score.js
│   │   └── events.js
│   │
│   ├── replay/
│   │   ├── engine.js
│   │   ├── buffer.js
│   │   ├── recorder.js
│   │   ├── clips.js
│   │   └── slowmotion.js
│   │
│   ├── graphics/
│   │   ├── engine.js
│   │   ├── score.js
│   │   ├── goal.js
│   │   ├── lowerThird.js
│   │   └── messages.js
│   │
│   └── ipc/
│       └── handlers.js
│
├── renderer/
│   ├── index.html
│   ├── css/
│   │   ├── main.css
│   │   └── components.css
│   │
│   └── js/
│       ├── app.js
│       ├── match.js
│       ├── replay.js
│       ├── graphics.js
│       └── settings.js
│
├── graphics/
│   ├── score/
│   ├── goal/
│   ├── lower-third/
│   └── replay/
│
├── config/
│   └── bos.json
│
└── media/
    ├── animations/
    ├── transitions/
    └── audio/

31. Core Principle
The most important architectural principle is:
BOS controls the broadcast; OBS produces the broadcast.

BOS knows:
WHAT should happen
WHEN it should happen
WHY it should happen

OBS knows:
HOW the final video is composited and output

FFmpeg knows:
HOW replay media is processed

The graphics system knows:
HOW broadcast graphics are rendered

32. Final Broadcast Flow
A complete goal event could therefore look like:
                  LIVE
                    │
                    │
              Goal occurs
                    │
                    ▼
             Operator presses
              GARNET GOAL
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
      Score +1          Replay capture
          │                   │
          ▼                   ▼
    Score animation      Clip preparation
          │                   │
          └─────────┬─────────┘
                    ▼
              Goal Animation
                    │
                    ▼
               Celebration
                    │
                    ▼
                 REPLAY
                    │
                    ▼
                SLOW-MO
                    │
                    ▼
              Return to LIVE

And independently, at any point:
Operator enters:

UNDER REVIEW
DECISION PENDING