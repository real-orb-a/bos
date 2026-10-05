BOS — Graphics, Animation & Transition Addendum
Specification Add-on — v1.0
1. Purpose
BOS must provide a flexible broadcast graphics and animation system based on:
- HTML
- CSS
- JavaScript
- Browser Sources in OBS
Animations must not be implemented exclusively as pre-rendered video files.
Pre-rendered video assets may be used where appropriate, but the BOS graphics system must allow custom animations to be created and modified using normal web technologies.
2. Graphics Architecture
Each graphic is effectively a small web application.
BOS
 │
 │ sends state/data
 ▼
HTML Graphics
 │
 ├── HTML
 ├── CSS
 └── JavaScript
 │
 ▼
OBS Browser Source
 │
 ▼
OBS Scene
 │
 ▼
Broadcast

For example:
graphics/
│
├── score/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── goal/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── replay/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── lower-third/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
└── transitions/
    ├── ...

3. HTML
HTML defines the actual graphic structure.
For example, a replay graphic could contain:
<div id="replayGraphic">
    <div class="replay-label">
        REPLAY
    </div>

    <div class="replay-line"></div>
</div>

The HTML does not need to know which match is currently running.
BOS supplies the data.
4. CSS
CSS controls the appearance and animation.
For example:
.replay-label {
    transform: translateX(-120%);
    opacity: 0;
}

.replay-label.active {
    animation: replayIn 500ms ease-out forwards;
}

@keyframes replayIn {
    from {
        transform: translateX(-120%);
        opacity: 0;
    }

    to {
        transform: translateX(0);
        opacity: 1;
    }
}

This allows the graphics designer/developer to create completely custom animations.
5. JavaScript
JavaScript controls the behaviour.
For example:
SHOW
 ↓
ENTER
 ↓
ACTIVE
 ↓
EXIT
 ↓
HIDDEN

JavaScript can also receive BOS data such as:
score
team
player
event
replay type
replay speed
message
duration
match clock

This allows one graphic to handle many different situations.
6. Custom Animation Lifecycle
Every BOS graphic should support an animation lifecycle:
HIDDEN
   │
   ▼
ENTER
   │
   ▼
ACTIVE
   │
   ▼
EXIT
   │
   ▼
HIDDEN

For example:
REPLAY graphic
      │
      ▼
Slide in
      │
      ▼
REPLAY
      │
      ▼
Remain visible
      │
      ▼
Fade out
      │
      ▼
Hidden

BOS should be able to tell the graphic when each stage occurs.
7. Custom Transitions
This is separate from an OBS scene transition.
BOS should support two types of transitions.
A. OBS transitions
Examples:
- Cut
- Fade
- Swipe
- Stinger
These are handled by OBS.
B. BOS custom graphical transitions
These are HTML/CSS/JS animations.
For example:
LIVE
 │
 ▼
Custom HTML transition
 │
 ├── animated bars
 ├── logo
 ├── team colours
 └── motion
 │
 ▼
REPLAY

This allows us to create much more advanced transitions than the standard OBS transitions.
8. How a Custom Transition Works
Suppose we want:
LIVE → REPLAY

BOS could execute:
LIVE
 │
 │ transition.start()
 ▼
TRANSITION GRAPHIC
 │
 │ animation plays
 ▼
OBS switches content
 │
 ▼
transition.complete()
 │
 ▼
REPLAY

The transition graphic can cover the screen.
For example:
┌─────────────────────────────────────┐
│                                     │
│          ███████████                │
│              REPLAY                 │
│          ███████████                │
│                                     │
└─────────────────────────────────────┘

The transition could use:
- Sliding panels
- Masks
- Scaling
- Rotation
- Blur
- Opacity
- Transformations
- SVG animations
- CSS keyframes
- JavaScript-controlled animation
- Team branding
9. Transition API
BOS should provide a simple interface to graphics.
Conceptually:
transition.start()
transition.complete()
transition.cancel()

The graphics itself controls the visual animation.
BOS controls when the transition begins and what happens afterward.
10. Replay Presentation
Replay should have its own graphic layer.
Instead of simply:
LIVE
 ↓
video

we should have:
LIVE
 ↓
REPLAY TRANSITION
 ↓
REPLAY VIDEO
 +
REPLAY GRAPHIC
 ↓
SLOW MOTION
 ↓
REPLAY EXIT
 ↓
LIVE

11. Custom "REPLAY" Graphic
During replay, BOS can display an HTML/CSS/JS graphic such as:
┌─────────────────────────────────────────┐
│                                         │
│                                         │
│                    REPLAY               │
│                                         │
│                                         │
└─────────────────────────────────────────┘

But it doesn't have to be static.
For example:
          ┌───────────────
          │ REPLAY
          └───────────────

could animate onto the screen.
A more sophisticated design could have:
──────────────────────────────
        REPLAY
──────────────────────────────

with an animated line travelling across the graphic.
12. Replay Graphic States
The replay graphic can have multiple states.
Enter
REPLAY

animates onto screen.
Active
REPLAY

remains visible while the clip plays.
Slow Motion
The graphic can change to:
REPLAY
SLOW MOTION

or:
REPLAY       ½×

Exit
The graphic animates away.
13. Replay Graphic Data
BOS should send information such as:
{
    "type": "replay",
    "team": "Garnet",
    "event": "Goal",
    "speed": 1,
    "slowMotion": false
}

When slow motion starts:
{
    "type": "replay",
    "speed": 0.5,
    "slowMotion": true
}

The HTML graphic can respond automatically.
14. Replay Identifier
Every replay should have an internal identifier.
For example:
REPLAY-001
REPLAY-002
REPLAY-003

This allows the graphics and replay engine to know exactly which replay is currently being played.
15. Multiple Replay Angles
The graphics architecture should also allow future support for:
REPLAY
 ├── Camera 1
 ├── Camera 2
 ├── Camera 3
 └── Camera 4

The replay graphic could optionally display:
REPLAY
CAMERA 3

or:
REPLAY
MAIN CAMERA

This shouldn't be required for v1, but the graphics API should not prevent it.
16. Lower Thirds
The same HTML/CSS/JS system handles lower thirds.
Example:
┌────────────────────────────────────────────────────┐
│ UNDER REVIEW                                       │
│ DECISION PENDING                                   │
└────────────────────────────────────────────────────┘

The operator can enter:
Title:
UNDER REVIEW

Subtitle:
DECISION PENDING

BOS passes that information to the graphic.
The graphic decides how it looks and animates.
17. Generic Message Graphic
The lower-third system must not be limited to "UNDER REVIEW."
The operator can enter:
MATCH DELAYED

or:
TECHNICAL DIFFICULTY

or:
MATCH RESUMING SHORTLY

or any other appropriate broadcast message.
The same graphic template is reused.
18. Animation Packages
A major requirement should be the ability to create animation packages.
For example:
packages/
└── ssl_media_2026/
    │
    ├── score/
    ├── goal/
    ├── replay/
    ├── review/
    ├── lower-third/
    ├── transitions/
    ├── assets/
    └── package.json

This means we could completely redesign the broadcast appearance without changing BOS's core logic.
19. Broadcast Package
A package can define:
Team branding
Fonts
Logos
Colours
Scoreboard
Goal animation
Replay animation
Lower thirds
Transitions
Match graphics

BOS simply loads the package.
This is particularly useful if the broadcast branding changes between events.
20. Example Replay Package
replay/
├── index.html
├── style.css
├── animation.js
├── assets/
│   ├── replay.svg
│   └── line.svg
└── package.json

The actual design can be completely custom.
BOS does not dictate:
"The replay must slide in from the left."

The package developer decides that.
21. Transparency
Graphics Browser Sources must support transparent backgrounds.
For example:
OBS Canvas
┌──────────────────────────────────────┐
│                                      │
│       LIVE CAMERA FOOTAGE            │
│                                      │
│   ┌────────────────────────────┐     │
│   │ UNDER REVIEW               │     │
│   └────────────────────────────┘     │
│                                      │
└──────────────────────────────────────┘

Only the graphic itself is rendered by the Browser Source.
The camera remains underneath it.
22. Animation Synchronisation
BOS must be able to synchronise:
OBS scene changes
        +
HTML animation
        +
Replay playback
        +
Match state

For example:
0.0s  Start transition
0.3s  Begin OBS scene change
0.7s  Transition reaches full coverage
0.8s  Replay starts
1.2s  REPLAY graphic enters

The timing should be configurable rather than hard-coded.
23. Animation Events
Graphics should be able to notify BOS about important points.
For example:
animation.started
animation.covered
animation.finished
animation.cancelled

This allows BOS to coordinate the broadcast accurately.
For example:
Transition started
      ↓
Transition covered screen
      ↓
Switch OBS source
      ↓
Replay begins
      ↓
Transition finishes

This is much better than simply saying:
"Wait 1 second and hope the animation is finished."

24. Custom Transition Example
A replay transition could be:
LIVE
 │
 ▼
┌──────────────────────────────┐
│                              │
│        GARNET / TOPAZ        │
│                              │
└──────────────────────────────┘
 │
 ▼
Screen splits vertically
 │
 ▼
REPLAY
 │
 ▼
Replay footage

Another broadcast package could use:
LIVE
 ↓
Diagonal wipe
 ↓
REPLAY

Another could use:
LIVE
 ↓
Zoom + blur
 ↓
REPLAY

BOS doesn't care.
The HTML/CSS/JS package defines the visual effect.
25. Important Rule
The BOS core must never contain the actual animation design.
Instead:
BOS Core
   │
   │ "show replay transition"
   ▼
Graphics Package
   │
   ├── HTML
   ├── CSS
   └── JS
   │
   ▼
OBS Browser Source

This makes BOS a broadcast platform, rather than a single fixed broadcast design.
26. Final Requirement
Add the following requirement to the main BOS specification:
All dynamic broadcast graphics and animations shall support implementation through HTML, CSS, and JavaScript rendered using OBS Browser Sources. BOS shall provide the state, data, lifecycle events, and timing required by graphics packages, while the graphics package itself shall define the visual appearance and animation behaviour. The system shall support persistent graphics, event graphics, lower thirds, replay graphics, custom transitions, goal animations, review/status messages, and other broadcast elements.

And specifically:
Replay presentation shall support custom HTML/CSS/JS replay transitions and persistent replay indicators. A replay package may display elements such as "REPLAY", playback speed, camera identifier, event type, team, or other information. Replay graphics may change state during normal-speed and slow-motion playback.