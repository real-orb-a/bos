// Syntax and smoke validation script
const fs = require('fs');
const path = require('path');

console.log('--- BOS Smoke Test ---');

const ConfigManager = require('./electron/config');
const OBSClient = require('./electron/obs/client');
const ScenesController = require('./electron/obs/scenes');
const SourcesController = require('./electron/obs/sources');
const TransitionsController = require('./electron/obs/transitions');
const ScoreManager = require('./electron/match/score');
const EventLogger = require('./electron/match/events');
const MatchEngine = require('./electron/match/engine');
const GoalWorkflowManager = require('./electron/match/goalWorkflow');
const ReplayBuffer = require('./electron/replay/buffer');
const ReplayRecorder = require('./electron/replay/recorder');
const ClipsManager = require('./electron/replay/clips');
const SlowMotionProcessor = require('./electron/replay/slowmotion');
const ReplayEngine = require('./electron/replay/engine');
const ClipSequenceManager = require('./electron/replay/sequence');
const ScoreGraphicsController = require('./electron/graphics/score');
const GoalGraphicsController = require('./electron/graphics/goal');
const LowerThirdGraphicsController = require('./electron/graphics/lowerThird');
const MessagesManager = require('./electron/graphics/messages');
const GraphicsEngine = require('./electron/graphics/engine');

const cfg = new ConfigManager();
console.log('✓ Config loaded. OBS Host:', cfg.get('obs.host'));

const score = new ScoreManager(cfg);
console.log('✓ ScoreManager loaded. Initial:', score.getScore());

const events = new EventLogger();
const match = new MatchEngine(score, events, cfg);
console.log('✓ MatchEngine loaded. State:', match.getFullState().matchState);

const obs = new OBSClient(cfg);
const scenes = new ScenesController(obs, cfg);
const sources = new SourcesController(obs, cfg);
const trans = new TransitionsController(obs, cfg);
console.log('✓ OBS modules loaded.');

const graphics = new GraphicsEngine(cfg, score, match);
console.log('✓ GraphicsEngine started on port:', graphics.port);

const replay = new ReplayEngine(cfg, obs, scenes, sources, match, graphics);
console.log('✓ ReplayEngine initialized.');

const clipSequence = new ClipSequenceManager(cfg, replay);
console.log(`✓ ClipSequenceManager loaded. Entries: ${clipSequence.getState().entries.length}, loop: ${clipSequence.getState().loop}`);

const gw = new GoalWorkflowManager(cfg, match, score, events, graphics, replay, scenes);
console.log('✓ GoalWorkflowManager initialized.');

// Cleanup test
graphics.destroy();
replay.destroy();
match.destroy();

console.log('All backend modules loaded and validated successfully!');
process.exit(0);
