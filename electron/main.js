const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

const ConfigManager = require('./config');
const OBSClient = require('./obs/client');
const ScenesController = require('./obs/scenes');
const SourcesController = require('./obs/sources');
const TransitionsController = require('./obs/transitions');
const ScoreManager = require('./match/score');
const EventLogger = require('./match/events');
const MatchEngine = require('./match/engine');
const GraphicsEngine = require('./graphics/engine');
const ReplayEngine = require('./replay/engine');
const GoalWorkflowManager = require('./match/goalWorkflow');
const registerIpcHandlers = require('./ipc/handlers');
const SessionManager = require('./sessionManager');
const loadTeamCatalog = require('./teamCatalog');

let mainWindow = null;
let configManager = null;
let obsClient = null;
let scenesController = null;
let sourcesController = null;
let transitionsController = null;
let scoreManager = null;
let eventLogger = null;
let matchEngine = null;
let graphicsEngine = null;
let replayEngine = null;
let goalWorkflow = null;
let sessionManager = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#090d16',
    title: 'SLC — Sports Livestream Controller',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initializeApp() {
  console.log('[SLC] Initializing Sports Livestream Controller...');

  configManager = new ConfigManager();
  sessionManager = new SessionManager(path.join(app.getPath('userData'), 'slc-session.json'));
  scoreManager = new ScoreManager(configManager);
  eventLogger = new EventLogger();
  matchEngine = new MatchEngine(scoreManager, eventLogger, configManager);
  const recovery = sessionManager.getState();
  if (recovery.recoverable && recovery.activeSession.snapshot) {
    const snapshot = recovery.activeSession.snapshot;
    if (snapshot.score) {
      scoreManager.updateTeams({
        home: snapshot.score.home,
        away: snapshot.score.away
      });
    }
    if (snapshot.match) matchEngine.restoreState(snapshot.match);
  }

  obsClient = new OBSClient(configManager);
  scenesController = new ScenesController(obsClient, configManager);
  sourcesController = new SourcesController(obsClient, configManager);
  transitionsController = new TransitionsController(obsClient, configManager);

  graphicsEngine = new GraphicsEngine(configManager, scoreManager, matchEngine);
  if (recovery.recoverable) {
    graphicsEngine.setScorebugVisible(!['athletics', 'formal-event'].includes(recovery.activeSession.modeId));
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    graphicsEngine.setScorebugMatchName(recovery.activeSession.competition.name);
    graphicsEngine.setSportScorebugState(recovery.activeSession);
  }
  replayEngine = new ReplayEngine(configManager, obsClient, sourcesController, scenesController);
  obsClient.on('mediaPlaybackEnded', inputName => {
    replayEngine.handlePlaybackEnded(inputName).catch(error => {
      console.error('[SLC] Replay ended, but OBS did not return to LIVE:', error.message);
    });
  });
  goalWorkflow = new GoalWorkflowManager(configManager, matchEngine, scoreManager, eventLogger, graphicsEngine, replayEngine, scenesController);

  createWindow();

  registerIpcHandlers({
    mainWindow,
    configManager,
    obsClient,
    scenesController,
    sourcesController,
    transitionsController,
    scoreManager,
    matchEngine,
    eventLogger,
    replayEngine,
    graphicsEngine,
    goalWorkflow,
    sessionManager,
    loadTeamCatalog
  });

  sessionManager.on('storageError', error => {
    console.error('[SLC] Session recovery could not be saved:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:storageError', error.message);
    }
  });

  obsClient.on('streamStatusChanged', ({ active }) => {
    const current = sessionManager.getState().activeSession;
    if (current && current.status !== 'ENDED') {
      sessionManager.updateStatus(active ? 'LIVE' : 'PAUSED');
    }
  });

  const saveSessionSnapshot = () => {
    sessionManager.saveSnapshot(scoreManager.getScore(), matchEngine.getFullState());
  };
  scoreManager.on('scoreChanged', saveSessionSnapshot);
  scoreManager.on('teamsUpdated', saveSessionSnapshot);
  matchEngine.on('clockTick', saveSessionSnapshot);
  matchEngine.on('clockChanged', saveSessionSnapshot);
  matchEngine.on('stateChanged', saveSessionSnapshot);
  matchEngine.on('setsChanged', saveSessionSnapshot);

  // Attempt initial OBS connection
  obsClient.connect().catch((err) => {
    console.warn('[SLC] OBS auto-connect notice:', err.message);
  });
}

app.whenReady().then(initializeApp).catch(error => {
  console.error('[SLC] Startup failed:', error);
  dialog.showErrorBox('SLC could not start', error.message || 'An unexpected startup error occurred.');
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[SLC] Cleaning up system resources before exit...');
  if (sessionManager) sessionManager.flush();
  if (replayEngine) replayEngine.destroy();
  if (graphicsEngine) graphicsEngine.destroy();
  if (matchEngine) matchEngine.destroy();
  if (obsClient) obsClient.disconnect();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
