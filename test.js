// Syntax and smoke validation script
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

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
cfg.set('graphics.httpPort', 0);
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
let workflowFailures = 0;
const workflowValidation = (async () => {
  cfg.set('goalWorkflow.showGoalAnimation', false);
  cfg.set('goalWorkflow.celebrationDurationSeconds', 0);
  cfg.set('goalWorkflow.captureReplayOnGoal', true);
  let replaySceneRequests = 0;
  let liveSceneRequests = 0;
  let replayCaptureRequests = 0;
  gw.scenes.switchToReplay = async () => {
    replaySceneRequests++;
    return true;
  };
  gw.scenes.switchToLive = async () => {
    liveSceneRequests++;
    return true;
  };
  gw.replay.captureAllReplays = async () => {
    replayCaptureRequests++;
    return { ok: true };
  };
  const waitForOperator = stepToWaitFor => new Promise(resolve => {
    const onStep = ({ step }) => {
      if (step === stepToWaitFor) {
        gw.removeListener('workflowStep', onStep);
        resolve();
      }
    };
    gw.on('workflowStep', onStep);
  });
  const waitingForReplayOptIn = waitForOperator('WAITING_FOR_REPLAY_OPT_IN');
  const goalSequence = gw.triggerGoal('home');
  await waitingForReplayOptIn;
  const remainedLiveByDefault = replaySceneRequests === 0 && liveSceneRequests === 0;
  const replayOptInAccepted = gw.goToReplay();
  const waitingForLiveReturn = waitForOperator('WAITING_FOR_GO_AHEAD');
  await waitingForLiveReturn;
  const returnedToLive = await gw.continueToLive();
  const sequenceResult = await goalSequence;
  if (remainedLiveByDefault && replayOptInAccepted && returnedToLive && sequenceResult === true && replaySceneRequests === 1 &&
      replayCaptureRequests === 1 && liveSceneRequests === 1 && !gw.getStatus().isRunning) {
    console.log('✓ Workflow: LIVE stays on air until replay opt-in, then GO AHEAD returns LIVE');
  } else {
    workflowFailures++;
    console.error('✗ Workflow: replay return flow failed', {
      returnedToLive, sequenceResult, replaySceneRequests, replayCaptureRequests,
      liveSceneRequests, status: gw.getStatus()
    });
  }

  const waitingForCancellation = waitForOperator('WAITING_FOR_REPLAY_OPT_IN');
  const cancellableSequence = gw.triggerGoal('away');
  await waitingForCancellation;
  await gw.abort();
  const cancelledResult = await cancellableSequence;
  if (cancelledResult === false && replaySceneRequests === 1 && replayCaptureRequests === 2 &&
      liveSceneRequests === 2 && !gw.getStatus().isRunning) {
    console.log('✓ Workflow: cancellation before replay opt-in leaves program LIVE');
  } else {
    workflowFailures++;
    console.error('✗ Workflow: cancellation did not return cleanly to LIVE', {
      cancelledResult, replaySceneRequests, replayCaptureRequests,
      liveSceneRequests, status: gw.getStatus()
    });
  }

  const waitingToCancelReplay = waitForOperator('WAITING_FOR_REPLAY_OPT_IN');
  const replayCancellationSequence = gw.triggerGoal('home');
  await waitingToCancelReplay;
  gw.goToReplay();
  await waitForOperator('WAITING_FOR_GO_AHEAD');
  await gw.abort();
  const replayCancellationResult = await replayCancellationSequence;
  if (replayCancellationResult === false && replaySceneRequests === 2 &&
      replayCaptureRequests === 3 && liveSceneRequests === 3 && !gw.getStatus().isRunning) {
    console.log('✓ Workflow: cancelling after replay opt-in returns to LIVE');
  } else {
    workflowFailures++;
    console.error('✗ Workflow: cancellation while replay is on air failed', {
      replayCancellationResult, replaySceneRequests, replayCaptureRequests,
      liveSceneRequests, status: gw.getStatus()
    });
  }
})().catch(error => {
  workflowFailures++;
  console.error('✗ Workflow validation failed:', error.message);
});

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
assertClock('zero-duration message remains on air until explicitly hidden',
  graphics.lowerThird.getState().isVisible && graphics.lowerThird.getState().remainingSeconds === 0);
assertClock('notice presets all use standard style',
  graphics.messages.getPresets().every(preset => preset.style === 'standard'));
score.updateTeams({ home: { name: 'HOME TEST' }, away: { name: 'AWAY TEST' } });
const timeoutPresets = graphics.messages.getPresets(score.getScore()).filter(preset => preset.id.startsWith('timeout_'));
assertClock('timeout quick messages track the two configured team names',
  timeoutPresets.length === 2 &&
  timeoutPresets[0].buttonTitle === 'TIMEOUT CALLED — HOME TEST' &&
  timeoutPresets[0].title === 'TIMEOUT CALLED' &&
  timeoutPresets[0].subtitle === 'TIMEOUT CALLED BY HOME TEST' &&
  timeoutPresets[1].buttonTitle === 'TIMEOUT CALLED — AWAY TEST' &&
  timeoutPresets[1].subtitle === 'TIMEOUT CALLED BY AWAY TEST');
score.updateTeams({ home: { name: 'GARNET' }, away: { name: 'TOPAZ' } });
const queuedNotice = graphics.messages.enqueue({ title: 'QUEUED STYLE TEST', style: 'f1-banner', duration: 0 });
assertClock('queued notices always use standard style', queuedNotice.style === 'standard');
assertClock('queued message accepts zero duration for manual dismissal', queuedNotice.duration === 0);
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
assertClock('basketball offense timer defaults to 24 seconds',
  match.getOffenseClockState().active && match.getOffenseClockState().seconds === 24);
match.startOffenseClock();
match._tick();
assertClock('offense timer counts down independently',
  match.getOffenseClockState().running && match.getOffenseClockState().seconds === 23);
match.resetOffenseClock();
assertClock('offense timer reset restores its configured duration',
  !match.getOffenseClockState().running && match.getOffenseClockState().seconds === 24);
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

match.setTimerMode('none');
assertClock('no-time mode displays without a running clock',
  match.getClockState().formatted === 'NO TIME' && match.startClock().running === false);
match.setTimerMode('stopwatch');
match.resetClock();

const initialSets = match.getSetState();
match.setBestOfSets(3);
score.setScore(25, 22);
match.completeSet('home');
match.completeSet('away');
s = match.getSetState();
assertClock('volleyball set winners are stored and counted manually',
  s.bestOfSets === 3 && s.homeSets === 1 && s.awaySets === 1 &&
  s.completedSets[0].winner === 'home' && s.completedSets[0].points.home === 25 &&
  s.completedSets[0].points.away === 22 && score.home.score === 0 && score.away.score === 0 &&
  s.completedSets[1].winner === 'away');
s = match.removeCompletedSet(1);
assertClock('individual set removal updates the series and renumbers later sets',
  s.homeSets === 0 && s.awaySets === 1 && s.completedSets.length === 1 &&
  s.completedSets[0].number === 1 && s.completedSets[0].winner === 'away');
s = match.adjustSetTally('home', 1);
assertClock('live set tally can be increased without changing set history',
  s.homeSets === 1 && s.completedSets.length === 1 && s.completedSets[0].winner === 'away');
s = match.adjustSetTally('home', -1);
assertClock('live set tally can be decreased without changing set history',
  s.homeSets === 0 && s.completedSets.length === 1 && s.completedSets[0].winner === 'away');
const noNegativeSetTally = match.adjustSetTally('home', -1);
assertClock('live set tally cannot be decreased below zero', noNegativeSetTally.homeSets === 0);
let invalidSetRemovalRejected = false;
try {
  match.removeCompletedSet(2);
} catch {
  invalidSetRemovalRejected = true;
}
assertClock('removing a non-existent set is rejected', invalidSetRemovalRejected);
match.resetSets();
match.setBestOfSets(3);
score.setScore(2, 0);
match.completeSet('home');
score.setScore(0, 2);
match.completeSet('away');
const permissiveBestOfState = match.setBestOfSets(1);
assertClock('best-of count can be lowered below completed sets without deleting results',
 permissiveBestOfState.bestOfSets === 1 && permissiveBestOfState.completedSets.length === 2);
score.setScore(8, 6);
const scoreAndSetsReset = match.resetScoreAndSets();
assertClock('manual match score reset also clears completed sets',
  scoreAndSetsReset.score.home.score === 0 && scoreAndSetsReset.score.away.score === 0 &&
  scoreAndSetsReset.sets.completedSets.length === 0 &&
  scoreAndSetsReset.sets.homeSets === 0 && scoreAndSetsReset.sets.awaySets === 0);
match.setBestOfSets(initialSets.bestOfSets);

match.setTimerMode('stopwatch');
match.resetClock();
console.log('✓ Match, message, and volleyball assertions complete.');

let remoteFailures = 0;
const assertRemote = (label, condition) => {
  if (condition) {
    console.log('✓ Remote:', label);
  } else {
    remoteFailures++;
    console.error('✗ Remote:', label);
  }
};
const waitForSocketMessage = (socket, type, predicate = () => true) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.off('message', onMessage);
    reject(new Error(`Timed out waiting for ${type}`));
  }, 3000);
  const onMessage = raw => {
    const message = JSON.parse(raw.toString());
    if (message.type !== type || !predicate(message)) return;
    clearTimeout(timeout);
    socket.off('message', onMessage);
    resolve(message);
  };
  socket.on('message', onMessage);
});
const waitForSocketEvent = (socket, event) => new Promise(resolve => socket.once(event, resolve));
const waitForSocketOpen = socket => socket.readyState === WebSocket.OPEN
  ? Promise.resolve()
  : waitForSocketEvent(socket, 'open');

const remoteValidation = (async () => {
  await workflowValidation;
  let queueUpdates = 0;
  const onQueueUpdated = () => { queueUpdates++; };
  graphics.on('queueUpdated', onQueueUpdated);
  const queuedForAir = graphics.enqueueMessage({ title: 'QUEUE START TEST', duration: 0 });
  await new Promise(resolve => setTimeout(resolve, 600));
  assertRemote('queue changes notify the dashboard and queued messages air when idle',
    queueUpdates > 0 && graphics.lowerThird.getState().currentData?.title === 'QUEUE START TEST');
  graphics.off('queueUpdated', onQueueUpdated);
  graphics.hideLowerThird();
  if (!graphics.httpServer.listening) {
    await new Promise((resolve, reject) => {
      graphics.httpServer.once('listening', resolve);
      graphics.httpServer.once('error', reject);
    });
  }

  const info = graphics.getRemoteControlInfo();
  assertRemote('a random key is generated and served on the actual HTTP port',
    info.password.length >= 8 && info.port > 0);
  assertRemote('immediate score changes default to disabled and persist in config',
    info.immediateScore === false && cfg.get('graphics.remoteImmediateScore') === false);

  const deniedSocket = new WebSocket(`ws://127.0.0.1:${info.port}/ws`);
  const deniedInitial = waitForSocketMessage(deniedSocket, 'INITIAL_SYNC');
  await waitForSocketOpen(deniedSocket);
  await deniedInitial;
  const deniedAuth = waitForSocketMessage(deniedSocket, 'REMOTE_AUTH_RESULT');
  deniedSocket.send(JSON.stringify({ type: 'REMOTE_AUTH', password: 'incorrect-password' }));
  const denial = await deniedAuth;
  assertRemote('invalid password is rejected', !denial.authenticated);
  deniedSocket.close();

  const socket = new WebSocket(`ws://127.0.0.1:${info.port}/ws`);
  try {
    const initialSync = waitForSocketMessage(socket, 'INITIAL_SYNC');
    await waitForSocketOpen(socket);
    await initialSync;

    const before = score.getScore().home.score;
    const unauthenticatedCommand = waitForSocketMessage(socket, 'REMOTE_COMMAND_RESULT');
    socket.send(JSON.stringify({
      type: 'REMOTE_COMMAND',
      action: 'SCORE_APPLY',
      homeDelta: 1,
      awayDelta: 0
    }));
    const blockedCommand = await unauthenticatedCommand;
    assertRemote('score approval is blocked before authentication',
      !blockedCommand.ok && score.getScore().home.score === before);

    const authResponse = waitForSocketMessage(socket, 'REMOTE_AUTH_RESULT');
    socket.send(JSON.stringify({ type: 'REMOTE_AUTH', password: info.password }));
    const authResult = await authResponse;
    assertRemote('configured password authenticates the remote', authResult.authenticated);

    const scoreProposalResponse = waitForSocketMessage(socket, 'REMOTE_COMMAND_RESULT',
      result => result.action === 'SCORE_PROPOSAL');
    socket.send(JSON.stringify({
      type: 'REMOTE_COMMAND',
      action: 'SCORE_PROPOSAL',
      homeDelta: 1,
      awayDelta: 0
    }));
    const scoreProposal = await scoreProposalResponse;
    assertRemote('remote score adjustment is queued without changing the live score',
      scoreProposal.ok && score.getScore().home.score === before &&
      graphics.getRemoteScoreProposals().some(proposal => proposal.id === scoreProposal.proposalId));

    const scoreUpdate = waitForSocketMessage(socket, 'SCORE_UPDATE', update => update.home.score === before + 1);
    graphics.approveRemoteScoreProposal(scoreProposal.proposalId);
    await scoreUpdate;
    assertRemote('approved score change is applied by the server', score.getScore().home.score === before + 1);

    const rejectedProposalResponse = waitForSocketMessage(socket, 'REMOTE_COMMAND_RESULT',
      result => result.action === 'SCORE_PROPOSAL');
    socket.send(JSON.stringify({
      type: 'REMOTE_COMMAND',
      action: 'SCORE_PROPOSAL',
      homeDelta: 1,
      awayDelta: 0
    }));
    const rejectedProposal = await rejectedProposalResponse;
    graphics.rejectRemoteScoreProposal(rejectedProposal.proposalId);
    assertRemote('BOS can reject a remote score request without changing scores',
      score.getScore().home.score === before + 1 &&
      !graphics.getRemoteScoreProposals().some(proposal => proposal.id === rejectedProposal.proposalId));

    const blockedImmediate = waitForSocketMessage(socket, 'REMOTE_COMMAND_RESULT');
    socket.send(JSON.stringify({
      type: 'REMOTE_COMMAND',
      action: 'SCORE_ADJUST',
      team: 'away',
      amount: 1
    }));
    assertRemote('immediate score changes are rejected while the BOS toggle is off',
      !(await blockedImmediate).ok);

    const scoreModeUpdate = waitForSocketMessage(socket, 'REMOTE_SCORE_MODE', mode => mode.immediate);
    graphics.setRemoteImmediateScore(true);
    await scoreModeUpdate;
    assertRemote('BOS immediate score toggle persists and syncs to the remote',
      cfg.get('graphics.remoteImmediateScore') === true && graphics.getRemoteControlInfo().immediateScore === true);

    const beforeAway = score.getScore().away.score;
    const immediateUpdate = waitForSocketMessage(socket, 'SCORE_UPDATE', update => update.away.score === beforeAway + 1);
    socket.send(JSON.stringify({
      type: 'REMOTE_COMMAND',
      action: 'SCORE_ADJUST',
      team: 'away',
      amount: 1
    }));
    await immediateUpdate;
    assertRemote('immediate score command updates server state directly', score.getScore().away.score === beforeAway + 1);

    const scoreModeDisabled = waitForSocketMessage(socket, 'REMOTE_SCORE_MODE', mode => !mode.immediate);
    graphics.setRemoteImmediateScore(false);
    await scoreModeDisabled;

    match.setClock({ seconds: 0, regulationMinutes: 90, stoppageMinutes: 0 });
    const clockUpdate = waitForSocketMessage(socket, 'CLOCK_UPDATE', clock => clock.clock.running);
    socket.send(JSON.stringify({ type: 'REMOTE_COMMAND', action: 'CLOCK_TOGGLE' }));
    await clockUpdate;
    assertRemote('authenticated client can start the match clock', match.getClockState().running);
    match.pauseClock();

    const startTimeResult = waitForSocketMessage(socket, 'REMOTE_COMMAND_RESULT',
      result => result.action === 'CLOCK_SET_START');
    socket.send(JSON.stringify({
      type: 'REMOTE_COMMAND',
      action: 'CLOCK_SET_START',
      seconds: 90
    }));
    assertRemote('remote can set the configured clock start time',
      (await startTimeResult).ok && match.getClockState().startSeconds === 90 &&
      match.getClockState().elapsedSeconds === 90);

    const adjustedClockResult = waitForSocketMessage(socket, 'REMOTE_COMMAND_RESULT',
      result => result.action === 'CLOCK_SET');
    socket.send(JSON.stringify({ type: 'REMOTE_COMMAND', action: 'CLOCK_SET', seconds: 150 }));
    assertRemote('remote can adjust the live clock value',
      (await adjustedClockResult).ok && match.getClockState().elapsedSeconds === 150);

    const periodResult = waitForSocketMessage(socket, 'REMOTE_COMMAND_RESULT',
      result => result.action === 'CLOCK_SET_PERIOD');
    socket.send(JSON.stringify({ type: 'REMOTE_COMMAND', action: 'CLOCK_SET_PERIOD', period: 'Q3' }));
    assertRemote('remote can update the period label',
      (await periodResult).ok && match.getClockState().period === 'Q3');

    const authRequired = waitForSocketMessage(socket, 'REMOTE_AUTH_REQUIRED');
    const changedPassword = 'updated-remote-password';
    graphics.setRemoteControlPassword(changedPassword);
    await authRequired;
    assertRemote('changing the stored password revokes current remote authentication',
      cfg.get('graphics.remoteControlKey') === changedPassword);

    const oldPasswordRejected = waitForSocketMessage(socket, 'REMOTE_AUTH_RESULT');
    socket.send(JSON.stringify({ type: 'REMOTE_AUTH', password: info.password }));
    assertRemote('old password no longer authenticates', !(await oldPasswordRejected).authenticated);

    const newPasswordAccepted = waitForSocketMessage(socket, 'REMOTE_AUTH_RESULT');
    socket.send(JSON.stringify({ type: 'REMOTE_AUTH', password: changedPassword }));
    assertRemote('new stored password authenticates', (await newPasswordAccepted).authenticated);
  } finally {
    socket.close();
  }
})().catch(error => {
  remoteFailures++;
  console.error('✗ Remote validation failed:', error.message);
});

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
  if (workflowFailures > 0) {
    console.error(`${workflowFailures} workflow assertion(s) FAILED`);
    process.exit(1);
  }
  if (remoteFailures > 0) {
    console.error(`${remoteFailures} remote assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('All backend modules loaded and validated successfully!');
  process.exit(0);
};
setTimeout(() => Promise.all([workflowValidation, remoteValidation]).finally(check), 500);