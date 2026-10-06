// Syntax and smoke validation script
const fs = require('fs');
const os = require('os');
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
const ReplayEngine = require('./electron/replay/engine');
const ScoreGraphicsController = require('./electron/graphics/score');
const GoalGraphicsController = require('./electron/graphics/goal');
const LowerThirdGraphicsController = require('./electron/graphics/lowerThird');
const MessagesManager = require('./electron/graphics/messages');
const GraphicsEngine = require('./electron/graphics/engine');

// Use a throwaway config so tests can never write to the live operator config.
const testConfigPath = path.join(os.tmpdir(), `bos-test-config-${Date.now()}.json`);
const cfg = new ConfigManager(testConfigPath);
console.log('✓ Config loaded (temp test config). OBS Host:', cfg.get('obs.host'));

// The live operator config must stay parseable — strictly read-only check.
try {
  const liveRaw = fs.readFileSync(path.join(__dirname, 'config', 'bos.json'), 'utf8');
  JSON.parse(liveRaw);
  console.log('✓ Live config/bos.json parses (read-only check).');
} catch (e) {
  console.error('✗ Live config/bos.json failed to parse:', e.message);
  process.exit(1);
}

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

const replay = new ReplayEngine(cfg, obs);
console.log('✓ ReplayEngine (Source Record trigger) loaded. Replay enabled:', replay.getStatus().enabled);

let replayFailures = 0;
const assertReplay = (label, cond) => {
  if (cond) {
    console.log('✓ Replay:', label);
  } else {
    replayFailures++;
    console.error('✗ Replay:', label);
  }
};

const cameraRequests = [];
const cameraReplayConfigValues = {
  'replay.enabled': true,
  'replay.hotkeyName': 'ReplayBuffer.Save',
  'replay.contextName': 'Main - Source Record',
  'replay.captureSources': [
    { id: 'main', name: 'Main', enabled: true, hotkeyName: '', contextName: '' },
    { id: 'cam1', name: 'Camera 1', enabled: true, hotkeyName: 'ReplayBuffer.Save', contextName: 'Cam 1 - Source Record' },
    { id: 'cam2', name: 'Camera 2', enabled: false, hotkeyName: 'ReplayBuffer.Save', contextName: 'Cam 2 - Source Record' }
  ]
};
const cameraReplay = new ReplayEngine({ get: key => cameraReplayConfigValues[key] }, {
  isConnected: true,
  call: async (...args) => cameraRequests.push(args)
});
cameraReplay.captureAllReplays().then(result => {
  assertReplay('SAVE ALL triggers both enabled cameras and skips disabled cameras',
    result.ok && result.results.length === 2 && cameraRequests.length === 2);
  assertReplay('each camera uses its own or shared hotkey context',
    cameraRequests[0][1].contextName === 'Main - Source Record' &&
    cameraRequests[1][1].contextName === 'Cam 1 - Source Record');
}).catch(error => {
  replayFailures++;
  console.error('✗ Replay: multi-camera capture failed:', error.message);
});

// Trigger-flow smoke: OBS not connected → capture must fail cleanly with ERROR state.
replay.captureReplay().then((res) => {
  console.log('✓ captureReplay with disconnected OBS →', res.state, '|', res.error);
});

const gw = new GoalWorkflowManager(cfg, match, score, events, graphics, replay, scenes);
console.log('✓ GoalWorkflowManager initialized.');

// ---- Match clock rework: set time, additional-time overlay, timer modes ----
let clockFailures = 0;
const assertClock = (label, cond) => {
  if (cond) {
    console.log('✓ Clock:', label);
  } else {
    clockFailures++;
    console.error('✗ Clock:', label);
  }
};

const noticePayload = graphics.lowerThird.show({ title: 'STYLE TEST', style: 'alert', duration: 0 });
assertClock('lower-third requests always use standard style', noticePayload.data.style === 'standard');
assertClock('notice presets all use standard style',
  graphics.messages.getPresets().every(preset => preset.style === 'standard'));
const queuedNotice = graphics.messages.enqueue({ title: 'QUEUED STYLE TEST', style: 'f1-banner' });
assertClock('queued notices always use standard style', queuedNotice.style === 'standard');
graphics.messages.clearQueue();
graphics.lowerThird.hide();

assertClock('Garnet and Topaz have their default G/T binds',
  score.home.hotkey === 'KeyG' && score.away.hotkey === 'KeyT');
const paletteScore = new ScoreManager({
  get: () => ({ home: { name: 'EMERALD' }, away: { name: 'TOPAZ' } }),
  set() {}
}).getScore();
assertClock('Emerald and Topaz names resolve to E/T binds',
  paletteScore.home.hotkey === 'KeyE' && paletteScore.away.hotkey === 'KeyT');
score.updateTeams({ home: { name: 'EMERALD', hotkey: 'KeyE' } });
assertClock('Emerald branding accepts its E goal bind', score.home.hotkey === 'KeyE');
score.updateTeams({ home: { name: 'CUSTOM HOUSE', hotkey: 'KeyX' } });
assertClock('custom house accepts its own goal bind', score.home.hotkey === 'KeyX');
score.updateTeams({ home: { name: 'GARNET', hotkey: 'KeyG' } });

// A saved starting clock and sport-specific period label are both operator-editable.
match.setStartTime(125);
assertClock('starting clock accepts MM:SS input (02:05)', match.getClockState().formatted === '02:05');
match.resetClock();
assertClock('clock reset returns to the configured start time', match.getClockState().formatted === '02:05');
match.setPeriod('Q1');
assertClock('period label accepts a sport-specific value', match.getClockState().period === 'Q1');
match.setPeriod('1st Half');

// 1. Changing the period must NEVER rewrite the clock.
match.setClock({ seconds: 1234, period: '1st Half' });
match.setPeriod('2nd Half');
assertClock('setPeriod keeps the clock untouched (no auto 45:00)',
  match.getClockState().elapsedSeconds === 1234);
match.setPeriod('1st Half');

// 2. Stopwatch mode: count to the set time, freeze, then added time counts from 00:00.
match.setTimerMode('stopwatch');
match.setClock({ seconds: 58, regulationMinutes: 1, stoppageMinutes: 2 });
match.startClock();
match._tick(); // 59
match._tick(); // reaches the 60s set time → stoppage begins, main clock frozen
let s = match.getClockState();
assertClock('stopwatch freezes at the set time (01:00)', s.formatted === '01:00');
assertClock('additional time starts at 00:00', s.inStoppage === true && s.stoppageDisplay === '00:00' && s.running === true);

match._tick(); // 1s of added time consumed
assertClock('overlay ticks (00:01)', match.getClockState().stoppageDisplay === '00:01');

for (let i = 0; i < 60; i++) match._tick(); // 61s consumed → second added minute
s = match.getClockState();
assertClock('overlay enters the next added minute (01:01)', s.stoppageDisplay === '01:01');
assertClock('main clock stays frozen while overlay counts', s.formatted === '01:00');

for (let i = 0; i < 59; i++) match._tick(); // 120s consumed = allotted 2 minutes
s = match.getClockState();
assertClock('overlay finishes at 02:00 and the clock stops',
  s.stoppageDisplay === '02:00' && s.running === false && s.stoppageElapsedSeconds === 120);

// 3. Countdown mode reaches 00:00 and auto-stops with no additional time set.
match.setTimerMode('countdown');
match.setClock({ stoppageMinutes: 0 });
assertClock('countdown starts from the set time', match.getClockState().formatted === '01:00');
match.startClock();
for (let i = 0; i < 60; i++) match._tick();
s = match.getClockState();
assertClock('countdown reaches 00:00 and stops', s.formatted === '00:00' && s.running === false && s.inStoppage === false);

// 4. Setting additional time AT the set time starts the overlay immediately;
//    cancelling it clears the overlay and stops the clock.
match.setClock({ seconds: 0, stoppageMinutes: 1 });
s = match.getClockState();
assertClock('setting +1 at 00:00 starts the overlay counting', s.inStoppage === true && s.stoppageDisplay === '00:00' && s.running === true);
match.setClock({ stoppageMinutes: 0 });
s = match.getClockState();
assertClock('cancelling additional time clears the overlay and stops the clock',
  s.inStoppage === false && s.stoppageDisplay === '' && s.running === false);

// 5. Approval mode freezes at regulation until the operator explicitly approves added time.
match.setTimerMode('stopwatch');
match.setAdditionalTimeMode('approval');
match.setClock({ seconds: 58, regulationMinutes: 1, stoppageMinutes: 1 });
match.startClock();
match._tick();
match._tick();
s = match.getClockState();
assertClock('approval mode waits at regulation', s.awaitingStoppageApproval === true && s.running === false && s.inStoppage === false);
match.startClock();
assertClock('clock start cannot bypass added-time approval', match.getClockState().awaitingStoppageApproval === true);
match.approveAdditionalTime();
s = match.getClockState();
assertClock('approval starts the added-time clock at 00:00', s.awaitingStoppageApproval === false && s.inStoppage === true && s.stoppageDisplay === '00:00' && s.running === true);
match.setClock({ stoppageMinutes: 0 });
match.setAdditionalTimeMode('automatic');

match.setTimerMode('stopwatch');
match.resetClock();
console.log('✓ Clock rework assertions complete.');

const check = () => {
  try {
    JSON.stringify(cfg.get());
  } catch (e) {
    process.exit(1);
  }
  graphics.destroy();
  replay.destroy();
  cameraReplay.destroy();
  match.destroy();
  try { fs.unlinkSync(testConfigPath); } catch (e) { /* temp file may not exist */ }
  if (clockFailures > 0) {
    console.error(`${clockFailures} clock assertion(s) FAILED`);
    process.exit(1);
  }
  if (replayFailures > 0) {
    console.error(`${replayFailures} replay assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('All backend modules loaded and validated successfully!');
  process.exit(0);
};
setTimeout(check, 500);