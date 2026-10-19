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
const VolleyballStore = require('./match/volleyballStore');
const VolleyballEngine = require('./match/volleyball');
const BasketballStore = require('./match/basketballStore');
const BasketballEngine = require('./match/basketball');
const registerIpcHandlers = require('./ipc/handlers');

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
let volleyballEngine = null;
let basketballEngine = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#090d16',
    title: 'BOS — Broadcast Operator System',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// If config/bos.json could not be read, tell the operator once the window is up.
// The damaged file has already been copied aside by ConfigManager.
function reportConfigProblems() {
  const problem = configManager && configManager.loadError;
  if (!problem || !mainWindow) return;
  mainWindow.webContents.once('did-finish-load', () => {
    const preserved = problem.backupPath
      ? `The damaged file was kept as:\n${problem.backupPath}`
      : 'BOS could not copy the damaged file aside.';
    const saving = configManager.getStatus().writesBlocked
      ? '\n\nSaving settings is disabled this session to protect the original file.'
      : '\n\nBOS is running on default settings. Review Settings before going live; your previous values are in the preserved file.';
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'BOS configuration problem',
      message: 'config/bos.json could not be read.',
      detail: `${problem.message}\n\n${preserved}${saving}`
    }).catch(() => {});
  });
}

async function initializeApp() {
  console.log('[BOS] Initializing Broadcast Operator System...');

  configManager = new ConfigManager();
  scoreManager = new ScoreManager(configManager);
  eventLogger = new EventLogger();
  matchEngine = new MatchEngine(scoreManager, eventLogger, configManager);
  const volleyballStore = new VolleyballStore(path.join(app.getPath('userData'), 'volleyball', 'matches.json'));
  volleyballEngine = new VolleyballEngine(volleyballStore);
  const basketballStore = new BasketballStore(path.join(app.getPath('userData'), 'basketball', 'matches.json'));
  basketballEngine = new BasketballEngine(basketballStore);

  obsClient = new OBSClient(configManager);
  scenesController = new ScenesController(obsClient, configManager);
  sourcesController = new SourcesController(obsClient, configManager);
  transitionsController = new TransitionsController(obsClient, configManager);

  graphicsEngine = new GraphicsEngine(configManager, scoreManager, matchEngine, volleyballEngine, basketballEngine);
  replayEngine = new ReplayEngine(configManager, obsClient);
  goalWorkflow = new GoalWorkflowManager(configManager, matchEngine, scoreManager, eventLogger, graphicsEngine, replayEngine, scenesController);

  createWindow();
  reportConfigProblems();

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
    volleyballEngine,
    basketballEngine
  });

  // Attempt initial OBS connection
  obsClient.connect().catch((err) => {
    console.warn('[BOS] OBS auto-connect notice:', err.message);
  });
}

app.whenReady().then(initializeApp);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[BOS] Cleaning up system resources before exit...');
  if (replayEngine) replayEngine.destroy();
  if (volleyballEngine) volleyballEngine.destroy();
  if (basketballEngine) basketballEngine.destroy();
  if (graphicsEngine) graphicsEngine.destroy();
  if (matchEngine) matchEngine.destroy();
  if (obsClient) obsClient.disconnect();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
