// Syntax and smoke validation script
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

console.log('--- SLC Smoke Test ---');

const ConfigManager = require('./electron/config');
const SessionManager = require('./electron/sessionManager');
const loadTeamCatalog = require('./electron/teamCatalog');
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
const teamCatalog = loadTeamCatalog();
if (teamCatalog.length < 2 || teamCatalog.some(team => !team.logo.startsWith('data:image/png;base64,'))) {
  throw new Error('Configured teams and bundled logos did not load.');
}
console.log('✓ Configured team names and bundled logos load from teams.json.');
const inactiveTeamConfigPath = path.join(os.tmpdir(), `bos-inactive-team-${Date.now()}.json`);
const inactiveTeamConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'teams.json'), 'utf8'));
inactiveTeamConfig.teams.find(team => team.id === teamCatalog.at(-1).id).active = false;
fs.writeFileSync(inactiveTeamConfigPath, JSON.stringify(inactiveTeamConfig));
const activeOnlyCatalog = loadTeamCatalog(inactiveTeamConfigPath);
fs.unlinkSync(inactiveTeamConfigPath);
const disabledTeamId = teamCatalog.at(-1).id;
if (activeOnlyCatalog.length !== teamCatalog.length - 1 ||
    activeOnlyCatalog.some(team => team.id === disabledTeamId) ||
    !activeOnlyCatalog.every(team => team.active)) {
  throw new Error('Inactive teams were not excluded from the global team catalog.');
}
console.log('✓ Inactive teams are excluded from all team catalog consumers.');

const testSessionPath = path.join(os.tmpdir(), `slc-test-session-${Date.now()}.json`);
const sessions = new SessionManager(testSessionPath);
sessions.create({
  mode: 'formal-event',
  competitionName: 'School Awards Evening',
  venue: 'Main Hall'
});
sessions.activate();
sessions.saveSnapshot({ home: { name: 'A', score: 0 }, away: { name: 'B', score: 0 } }, {
  matchState: 'PRE_MATCH',
  clock: { elapsedSeconds: 0, formatted: '00:00' }
});
sessions.flush();
const recoveredSessions = new SessionManager(testSessionPath);
if (!recoveredSessions.getState().recoverable ||
    recoveredSessions.getState().activeSession.modeId !== 'formal-event' ||
    recoveredSessions.getState().activeSession.competition.name !== 'School Awards Evening') {
  throw new Error('Session recovery did not preserve the formal-event session.');
}
let invalidSessionRejected = false;
try {
  sessions.create({ mode: 'not-a-mode', competitionName: 'Invalid' });
} catch {
  invalidSessionRejected = true;
}
if (!invalidSessionRejected) throw new Error('Invalid session mode was accepted.');
const athleticsTestPath = path.join(os.tmpdir(), `slc-test-athletics-${Date.now()}.json`);
const athleticsLegacyTestPath = path.join(os.tmpdir(), `slc-test-athletics-legacy-${Date.now()}.json`);
const shotPutTestPath = path.join(os.tmpdir(), `slc-test-shot-put-${Date.now()}.json`);
const athleticsSession = new SessionManager(athleticsTestPath);
athleticsSession.create({
  mode: 'athletics',
  competitionName: 'House Sports Day',
  homeTeam: '',
  awayTeam: '',
  athleticsHouses: teamCatalog
});
const defaultHouses = athleticsSession.getActiveSession().athletics.houses;
if (defaultHouses.map(house => house.name).join(',') !== teamCatalog.map(team => team.name).join(',') ||
    !defaultHouses.every(house => house.logo.startsWith('data:image/png;base64,')) ||
    athleticsSession.getActiveSession().teams !== null) {
  throw new Error('Athletics did not initialize its configured houses and logos.');
}
const shotPutSession = new SessionManager(shotPutTestPath);
shotPutSession.create({
  mode: 'athletics',
  competitionName: 'Shot Put Test',
  athleticsHouses: teamCatalog
});
shotPutSession.setAthleticsEvent({ name: 'Shot Put Final', category: 'field' });
if (shotPutSession.getActiveSession().athletics.currentEvent.category !== 'shot-put') {
  throw new Error('Legacy field event categories were not normalized to Shot Put.');
}
shotPutSession.recordAthleticsResult({
  athleteName: 'A. Thrower',
  team: teamCatalog[0].name,
  attempt: 1,
  distance: 8
});
shotPutSession.recordAthleticsResult({
  athleteName: 'A. Thrower',
  team: teamCatalog[0].name,
  attempt: 2,
  distance: 9.25
});
shotPutSession.recordAthleticsResult({
  athleteName: 'B. Thrower',
  team: teamCatalog[1].name,
  attempt: 1,
  distance: 9
});
let shotPutResults = shotPutSession.getActiveSession().athletics.currentEvent.results;
if (shotPutResults[0].athleteName !== 'A. Thrower' ||
    shotPutResults[0].bestDistance !== 9.25 ||
    shotPutResults[0].result !== '9.25 m' ||
    shotPutResults[0].attempts[1] !== 9.25 ||
    shotPutResults[1].place !== 2 ||
    shotPutSession.getAthleticsStandings()[0].points !== 5) {
  throw new Error('Shot Put attempts did not produce best-mark rankings and house standings.');
}
shotPutSession.recordAthleticsResult({
  athleteName: 'A. Thrower',
  team: teamCatalog[0].name,
  attempt: 2,
  distance: 8.75
});
shotPutResults = shotPutSession.getActiveSession().athletics.currentEvent.results;
if (shotPutResults[0].athleteName !== 'B. Thrower' ||
    shotPutResults[1].bestDistance !== 8.75 ||
    shotPutResults[1].attempts[1] !== 8.75) {
  throw new Error('Correcting a Shot Put attempt did not recalculate the final mark and rank.');
}
const shotPutBroadcast = shotPutSession.getAthleticsBroadcastState();
if (shotPutBroadcast.event.category !== 'shot-put' ||
    shotPutBroadcast.event.results[1].attempts[1] !== 8.75) {
  throw new Error('Shot Put attempt data was not included in the live broadcast state.');
}
const recoveredShotPut = new SessionManager(shotPutTestPath).getActiveSession();
if (recoveredShotPut.athletics.currentEvent.results[1].bestDistance !== 8.75) {
  throw new Error('Shot Put attempt marks and rankings were not persisted for recovery.');
}
shotPutSession.removeAthleticsResult(shotPutResults[0].id);
shotPutResults = shotPutSession.getActiveSession().athletics.currentEvent.results;
if (shotPutResults.length !== 1 || shotPutResults[0].place !== 1 ||
    shotPutSession.getAthleticsStandings()[0].points !== 5) {
  throw new Error('Removing a Shot Put result did not recalculate ranks and house points.');
}
const basketballTestPath = path.join(os.tmpdir(), `slc-test-basketball-session-${Date.now()}.json`);
const basketballSession = new SessionManager(basketballTestPath);
basketballSession.create({
  mode: 'basketball',
  competitionName: 'Basketball Test',
  homeTeam: teamCatalog[0].name,
  awayTeam: teamCatalog[1].name,
  homeTeamBrand: teamCatalog[0],
  awayTeamBrand: teamCatalog[1]
});
if (basketballSession.getActiveSession().sportState.period !== '1st Quarter' ||
    basketballSession.getActiveSession().teams.home.logo !== teamCatalog[0].logo) {
  throw new Error('Basketball quarter label or configured team branding was not initialized.');
}
let longCompetitionNameRejected = false;
try {
  basketballSession.updateCompetitionName('x'.repeat(61));
} catch {
  longCompetitionNameRejected = true;
}
if (!longCompetitionNameRejected) throw new Error('Competition names over 60 characters were accepted.');
const volleyballTestPath = path.join(os.tmpdir(), `slc-test-volleyball-session-${Date.now()}.json`);
const volleyballSession = new SessionManager(volleyballTestPath);
volleyballSession.create({
  mode: 'volleyball',
  competitionName: 'Volleyball Test',
  homeTeam: teamCatalog[0].name,
  awayTeam: teamCatalog[1].name,
  homeTeamBrand: teamCatalog[0],
  awayTeamBrand: teamCatalog[1]
});
volleyballSession.updateSportState({
  pointsToWin: 5,
  decidingSetPointsToWin: 7,
  pointsToWinBy: 3
});
const volleyballScore = new ScoreManager(cfg);
volleyballScore.setScore(5, 4);
const volleyballCloseScore = volleyballSession.applyScoreChange('home', 1, volleyballScore);
const volleyballSetWinner = volleyballSession.applyScoreChange('home', 1, volleyballScore);
if (volleyballCloseScore.completed || volleyballSetWinner.completed?.winner !== 'home' ||
    volleyballSetWinner.completed.points.home !== 7 ||
    volleyballSession.getActiveSession().sportState.decidingSetPointsToWin !== 7) {
  throw new Error('Volleyball did not honor its configured set target and win margin.');
}
volleyballSession.updateSportState({ sets: { home: 2, away: 2 } });
volleyballScore.setScore(7, 6);
const decidingSetWinner = volleyballSession.applyScoreChange('home', 2, volleyballScore);
if (decidingSetWinner.completed?.points.home !== 9 || decidingSetWinner.completed.points.away !== 6) {
  throw new Error('Volleyball did not honor the configured deciding-set target.');
}
console.log('✓ Volleyball set targets and win-by margin are configurable.');
const emptyAthleticsBroadcast = athleticsSession.getAthleticsBroadcastState();
if (emptyAthleticsBroadcast.active !== true || emptyAthleticsBroadcast.event !== null) {
  throw new Error('Athletics broadcast state should remain active before an event is selected.');
}
console.log('✓ Athletics broadcast stays active before the live event title is set.');
athleticsSession.setAthleticsHouseLogo(defaultHouses[0].id, 'data:image/png;base64,aA==');
athleticsSession.addAthleticsHouse({ name: 'Sapphire' });
let duplicateHouseRejected = false;
try { athleticsSession.addAthleticsHouse({ name: 'garnet' }); } catch { duplicateHouseRejected = true; }
if (!duplicateHouseRejected ||
    athleticsSession.getActiveSession().athletics.houses.length !== defaultHouses.length + 1) {
  throw new Error('Athletics house validation did not prevent a duplicate house.');
}
athleticsSession.addParticipant({ name: 'A. Runner', type: 'athlete', team: 'Garnet', number: 12 });
athleticsSession.setAthleticsEvent({ name: '200m Level 01 Boys', category: 'track' });
const athleticsEvent = athleticsSession.getActiveSession().athletics.currentEvent;
athleticsSession.recordAthleticsResult({
  athleteName: 'A. Runner',
  team: 'Garnet',
  result: '12.4 s',
  place: 1,
  points: 5
});
athleticsSession.recordAthleticsResult({
  athleteName: 'B. Runner',
  team: 'Emerald',
  result: '12.8 s',
  place: 2,
  points: 3
});
const athleticsStandings = athleticsSession.getAthleticsStandings();
if (athleticsStandings[0].team !== 'Garnet' || athleticsStandings[0].points !== 5 ||
    athleticsStandings[1].medals.silver !== 1 ||
    athleticsSession.getActiveSession().athletics.currentEvent.results[0].athleteName !== 'A. Runner' ||
    !athleticsSession.getActiveSession().athletics.houses[0].logo) {
  throw new Error('Athletics result entry did not produce correct standings.');
}
const recoveredAthletics = new SessionManager(athleticsTestPath).getActiveSession();
if (recoveredAthletics.athletics.houses.length !== defaultHouses.length + 1 ||
    !recoveredAthletics.athletics.houses[0].logo ||
    recoveredAthletics.athletics.results.length !== 2 ||
    recoveredAthletics.athletics.currentEvent.name !== '200m Level 01 Boys') {
  throw new Error('Athletics houses, logos, and results were not persisted for recovery.');
}
const legacyAthletics = athleticsSession.getActiveSession();
legacyAthletics.athletics.schedule = [legacyAthletics.athletics.currentEvent];
legacyAthletics.athletics.activeEventId = legacyAthletics.athletics.currentEvent.id;
delete legacyAthletics.athletics.currentEvent;
delete legacyAthletics.athletics.podiumVisible;
fs.writeFileSync(athleticsLegacyTestPath, JSON.stringify({ activeSession: legacyAthletics }));
const migratedAthletics = new SessionManager(athleticsLegacyTestPath).getActiveSession();
if (migratedAthletics.athletics.currentEvent.name !== '200m Level 01 Boys' ||
    migratedAthletics.athletics.currentEvent.category !== 'running' ||
    migratedAthletics.athletics.currentEvent.results.length !== 2 ||
    'schedule' in migratedAthletics.athletics) {
  throw new Error('Legacy Athletics schedules were not migrated to the live event model.');
}
console.log('✓ Legacy Athletics schedule migrates to live event state.');
const athleticsBroadcast = athleticsSession.getAthleticsBroadcastState();
if (!athleticsBroadcast.active || athleticsBroadcast.event.name !== '200m Level 01 Boys' ||
    athleticsBroadcast.event.results.length !== 2 || !athleticsBroadcast.houses[0].logo) {
  throw new Error('Athletics broadcast standings did not include the live event and house logos.');
}
const updatedEvent = athleticsSession.setAthleticsEvent({
  name: 'Baton Relay Level 05 Boys',
  category: 'relay'
}).athletics.currentEvent;
if (updatedEvent.id !== athleticsEvent.id || updatedEvent.results.length !== 2) {
  throw new Error('The live event title should update dynamically without discarding live standings.');
}
athleticsSession.recordAthleticsResult({
  runnerNames: ['Runner One', 'Runner Two', 'Runner Three', 'Runner Four'],
  athleteName: 'Runner One → Runner Two → Runner Three → Runner Four',
  team: 'Garnet',
  result: '52.8 s',
  place: 1,
  points: 5
});
const relayBroadcast = athleticsSession.getAthleticsBroadcastState();
if (relayBroadcast.event.name !== 'Baton Relay Level 05 Boys' ||
    !relayBroadcast.event.results.some(result =>
      result.runnerNames.join(' → ') === 'Runner One → Runner Two → Runner Three → Runner Four')) {
  throw new Error('Relay runner order was not preserved for broadcast.');
}
athleticsSession.setAthleticsPodiumVisible(true);
const podiumBroadcast = athleticsSession.getAthleticsBroadcastState();
if (!podiumBroadcast.podiumVisible) {
  throw new Error('Athletics podium visibility was not enabled for broadcast.');
}
const relayEntry = athleticsSession.getActiveSession().athletics.currentEvent.results.find(result => result.runnerNames.length);
athleticsSession.removeAthleticsResult(relayEntry.id);
if (athleticsSession.getAthleticsBroadcastState().event.results.some(result => result.runnerNames.length)) {
  throw new Error('Removing a live result did not update the on-air standings.');
}
let invalidLogoRejected = false;
try { athleticsSession.setAthleticsHouseLogo(defaultHouses[1].id, 'https://example.invalid/logo.svg'); } catch { invalidLogoRejected = true; }
if (!invalidLogoRejected) throw new Error('Unvalidated external house logo was accepted.');
athleticsSession.create({
  mode: 'table-tennis',
  competitionName: 'Singles Final',
  homeTeam: 'Garnet',
  awayTeam: 'Emerald',
  tableTennisFormat: 'singles',
  tableTennisPlayers: { home: ['Home Player'], away: ['Away Player'] }
});
const presetTeams = athleticsSession.getActiveSession().teams;
if (presetTeams.home.primaryColor !== '#e11d48' ||
    presetTeams.away.primaryColor !== '#10b981' ||
    presetTeams.home.secondaryColor !== '#7f1d1d' ||
    presetTeams.away.secondaryColor !== '#064e3b') {
  throw new Error('Selected house presets did not retain their broadcast colors.');
}
if (athleticsSession.getActiveSession().sportState.tableTennis.players.home[0] !== 'Home Player') {
  throw new Error('Table tennis player names were not saved to the session.');
}
athleticsSession.create({
  mode: 'table-tennis',
  competitionName: 'Doubles Final',
  homeTeam: 'Garnet',
  awayTeam: 'Emerald',
  tableTennisFormat: 'doubles',
  tableTennisPlayers: {
    home: ['Home One', 'Home Two'],
    away: ['Away One', 'Away Two']
  }
});
if (athleticsSession.getActiveSession().sportState.tableTennis.players.away.length !== 2) {
  throw new Error('Table tennis doubles players were not saved to the session.');
}
athleticsSession.updateSportState({ pointsToWin: 15 });
if (athleticsSession.getActiveSession().sportState.pointsToWin !== 15) {
  throw new Error('Table tennis points-to-win target was not configurable.');
}
athleticsSession.updateSportState({ pointsToWin: 11 });
console.log('✓ Session team selection applies the selected house palettes.');
const gameConfigPath = path.join(os.tmpdir(), `slc-test-game-config-${Date.now()}.json`);
const gameConfig = new ConfigManager(gameConfigPath);
const gameScore = new ScoreManager(gameConfig);
const gameEvents = new EventLogger();
gameScore.setScore(10, 10);
athleticsSession.applyScoreChange('home', 1, gameScore, gameEvents);
const finalPoint = athleticsSession.applyScoreChange('home', 1, gameScore, gameEvents);
if (finalPoint.session.sportState.sets.home !== 1 ||
    finalPoint.score.home.score !== 0 ||
    !finalPoint.session.sportState.completedGames.length ||
    gameEvents.getEvents()[0].type !== 'GAME_COMPLETED') {
  throw new Error('Table tennis win-by-two scoring did not complete and reset the game.');
}
const nextGamePoint = athleticsSession.applyScoreChange('home', 1, gameScore, gameEvents);
if (nextGamePoint.completed !== null || nextGamePoint.score.home.score !== 1) {
  throw new Error('A point in the next game incorrectly repeated the previous game completion.');
}

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

const testMatchRestore = new MatchEngine(score, new EventLogger(), cfg);
testMatchRestore.setClock({ seconds: 73, period: 'Second Half' });
const matchSnapshot = testMatchRestore.getFullState();
testMatchRestore.startClock();
testMatchRestore.setTemporaryState('GOAL');
const restoredMatch = testMatchRestore.restoreState(matchSnapshot);
if (restoredMatch.clock.running || restoredMatch.clock.elapsedSeconds !== 73 ||
    restoredMatch.clock.period !== 'Second Half' || restoredMatch.tempState !== 'NONE') {
  throw new Error('Match recovery did not restore factual clock state safely.');
}
if (testMatchRestore.getOffenseClockState().enabled ||
    testMatchRestore.startOffenseClock().running) {
  throw new Error('The offense timer ran while disabled by default.');
}
const enabledOffense = testMatchRestore.setOffenseClockEnabled(true);
const runningOffense = testMatchRestore.startOffenseClock();
const disabledOffense = testMatchRestore.setOffenseClockEnabled(false);
if (!enabledOffense.enabled || !runningOffense.running ||
    disabledOffense.enabled || disabledOffense.running) {
  throw new Error('Enabling the offense timer did not start it or disabling it did not stop it.');
}
testMatchRestore.destroy();
console.log('✓ Session setup validates mode, recovery, and paused clock restoration.');

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
const volleyballScorebug = graphics.setSportScorebugState(volleyballSession.getActiveSession());
if (volleyballScorebug?.mode !== 'volleyball' || volleyballScorebug.target !== 7 ||
    volleyballScorebug.pointsToWinBy !== 3 || volleyballScorebug.homeSets !== 3 ||
    volleyballScorebug.awaySets !== 2) {
  throw new Error('Volleyball set state was not synchronized to the scorebug.');
}
const tableTennisScorebug = graphics.setSportScorebugState(athleticsSession.getActiveSession());
if (tableTennisScorebug?.mode !== 'table-tennis' ||
    tableTennisScorebug.target !== 11 ||
    tableTennisScorebug.pointsToWinBy !== 2 ||
    tableTennisScorebug.matchFormat !== 'doubles' ||
    tableTennisScorebug.homePlayers.join(',') !== 'Home One,Home Two' ||
    tableTennisScorebug.awayPlayers.join(',') !== 'Away One,Away Two') {
  throw new Error('Table tennis player names or doubles format were not synchronized to the scorebug.');
}
if (tableTennisScorebug.homeSets !== 1 || tableTennisScorebug.awaySets !== 0) {
  throw new Error('Table tennis set tally was not synchronized to the scorebug.');
}
athleticsSession.updateSportState({ pointsToWin: 15 });
if (graphics.setSportScorebugState(athleticsSession.getActiveSession()).target !== 15) {
  throw new Error('Table tennis scorebug target did not update when its rules changed.');
}
athleticsSession.updateSportState({ pointsToWin: 11 });
const cricketTestPath = path.join(os.tmpdir(), `slc-test-cricket-session-${Date.now()}.json`);
const cricketSession = new SessionManager(cricketTestPath);
cricketSession.create({
  mode: 'cricket',
  competitionName: 'Cricket Test',
  homeTeam: teamCatalog[0].name,
  awayTeam: teamCatalog[1].name,
  homeTeamBrand: teamCatalog[0],
  awayTeamBrand: teamCatalog[1]
});
cricketSession.updateSportState({
  period: '2nd Innings',
  wickets: { home: 2 },
  overs: { home: 8 }
});
const cricketScorebug = graphics.setSportScorebugState(cricketSession.getActiveSession());
if (cricketScorebug?.mode !== 'cricket' || cricketScorebug.period !== '2nd Innings' ||
    cricketScorebug.homeWickets !== 2 || cricketScorebug.homeOvers !== 8) {
  throw new Error('Cricket innings, wickets, or overs were not synchronized to the scorebug.');
}
graphics.setSportScorebugState(null);
if (graphics.setScorebugExpanded(true) !== true || !graphics.scorebugExpanded ||
    graphics.setScorebugExpanded(false) !== false || graphics.scorebugExpanded) {
  throw new Error('Scorebug expand/collapse state did not update.');
}
console.log('✓ Scorebug compact/expanded state is controllable.');
graphics.setAthleticsStandings(podiumBroadcast);
if (!graphics.athleticsStandings.active ||
    graphics.athleticsStandings.event.name !== 'Baton Relay Level 05 Boys' ||
    graphics.athleticsStandings.podiumVisible !== true) {
  throw new Error('GraphicsEngine did not publish the live Athletics podium state.');
}
graphics.setAthleticsStandings({ active: false, event: null, houses: [] });
console.log('✓ Athletics event standings can replace and clear the scorebug graphic.');

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

const replayAiringActions = [];
const airingEngine = new ReplayEngine(
  { get: key => ({
    'replay.enabled': true,
    'scenes.replayMediaSource': 'Replay Video'
  })[key] },
  { isConnected: true },
  {
    setMediaSourceFile: async (source, file) => {
      replayAiringActions.push(['load', source, file]);
      return true;
    },
    playMedia: async source => {
      replayAiringActions.push(['play', source]);
      return true;
    },
    stopMedia: async source => {
      replayAiringActions.push(['stop', source]);
      return true;
    }
  },
  {
    switchToReplay: async () => {
      replayAiringActions.push(['scene', 'REPLAY']);
      return true;
    },
    switchToLive: async () => {
      replayAiringActions.push(['scene', 'LIVE']);
      return true;
    }
  }
);
const replayAiringValidation = airingEngine.airReplay('/selected/replay.mp4').then(async aired => {
  const stopped = await airingEngine.stopReplay();
  assertReplay('selected replay loads in OBS, airs, stops, and returns LIVE',
    aired.ok && stopped.ok && replayAiringActions.map(action => action[0]).join(',') === 'load,scene,play,stop,scene');
}).catch(error => {
  replayFailures++;
  console.error('✗ Replay airing validation failed:', error.message);
  throw error;
});

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
  try { fs.unlinkSync(testSessionPath); } catch (e) { /* temp file may not exist */ }
  try { fs.unlinkSync(athleticsTestPath); } catch (e) { /* temp file may not exist */ }
  try { fs.unlinkSync(athleticsLegacyTestPath); } catch (e) { /* temp file may not exist */ }
  try { fs.unlinkSync(basketballTestPath); } catch (e) { /* temp file may not exist */ }
  try { fs.unlinkSync(volleyballTestPath); } catch (e) { /* temp file may not exist */ }
  try { fs.unlinkSync(cricketTestPath); } catch (e) { /* temp file may not exist */ }
  try { fs.unlinkSync(gameConfigPath); } catch (e) { /* temp file may not exist */ }
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
setTimeout(() => Promise.all([workflowValidation, remoteValidation, replayAiringValidation]).finally(check), 500);