const { app, BrowserWindow } = require('electron');
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

async function initializeApp() {
  console.log('[BOS] Initializing Broadcast Operator System...');

  configManager = new ConfigManager();
  scoreManager = new ScoreManager(configManager);
  eventLogger = new EventLogger();
  matchEngine = new MatchEngine(scoreManager, eventLogger, configManager);

  obsClient = new OBSClient(configManager);
  scenesController = new ScenesController(obsClient, configManager);
  sourcesController = new SourcesController(obsClient, configManager);
  transitionsController = new TransitionsController(obsClient, configManager);

  graphicsEngine = new GraphicsEngine(configManager, scoreManager, matchEngine);
  replayEngine = new ReplayEngine(configManager, obsClient);
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
    goalWorkflow
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
  if (graphicsEngine) graphicsEngine.destroy();
  if (matchEngine) matchEngine.destroy();
  if (obsClient) obsClient.disconnect();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
