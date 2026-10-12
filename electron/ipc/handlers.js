const { ipcMain } = require('electron');

function registerIpcHandlers({
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
}) {
  const sendToRenderer = (channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  // Bind Subsystem Events to Renderer
  obsClient.on('connected', (status) => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('disconnected', () => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('sceneChanged', (scene) => sendToRenderer('obs:sceneChanged', scene));
  obsClient.on('ping', (latency) => sendToRenderer('obs:ping', latency));

  scoreManager.on('scoreChanged', (data) => sendToRenderer('score:changed', data));
  scoreManager.on('teamsUpdated', (data) => sendToRenderer('score:teamsUpdated', data));

  matchEngine.on('clockTick', (clock) => sendToRenderer('match:clockTick', clock));
  matchEngine.on('clockChanged', (clock) => sendToRenderer('match:clockChanged', clock));
  matchEngine.on('setsChanged', (sets) => sendToRenderer('match:setsChanged', sets));
  matchEngine.on('stateChanged', (state) => sendToRenderer('match:stateChanged', state));
  matchEngine.on('temporaryStateChanged', (state) => sendToRenderer('match:tempStateChanged', state));

  eventLogger.on('eventAdded', (evt) => sendToRenderer('events:added', evt));
  eventLogger.on('eventsCleared', () => sendToRenderer('events:cleared'));

  replayEngine.on('replayStateChanged', (status) => sendToRenderer('replay:stateChanged', status));

  graphicsEngine.on('queueUpdated', (q) => sendToRenderer('graphics:queueUpdated', q));

  goalWorkflow.on('workflowStarted', (data) => sendToRenderer('workflow:started', data));
  goalWorkflow.on('workflowStep', (data) => sendToRenderer('workflow:step', data));
  goalWorkflow.on('workflowCompleted', (data) => sendToRenderer('workflow:completed', data));
  goalWorkflow.on('workflowAborted', () => sendToRenderer('workflow:aborted'));

  // --- OBS IPC Handlers ---
  ipcMain.handle('obs:connect', async () => {
    await obsClient.connect();
    return obsClient.getStatus();
  });
  ipcMain.handle('obs:disconnect', async () => {
    await obsClient.disconnect();
    return obsClient.getStatus();
  });
  ipcMain.handle('obs:getStatus', () => obsClient.getStatus());
  ipcMain.handle('obs:getScenes', async () => await scenesController.getScenes());
  ipcMain.handle('obs:switchScene', async (_, sceneName) => await scenesController.switchScene(sceneName));
  ipcMain.handle('obs:getTransitions', async () => await transitionsController.getTransitions());
  ipcMain.handle('obs:getCurrentTransition', async () => await transitionsController.getCurrentTransition());
  ipcMain.handle('obs:setTransition', async (_, name) => await transitionsController.setTransition(name));
  ipcMain.handle('obs:setTransitionDuration', async (_, ms) => await transitionsController.setDuration(ms));

  // --- Match Engine IPC Handlers ---
  ipcMain.handle('match:getState', () => matchEngine.getFullState());
  ipcMain.handle('match:setState', (_, state) => matchEngine.setMatchState(state));
  ipcMain.handle('match:clockStart', () => matchEngine.startClock());
  ipcMain.handle('match:clockPause', () => matchEngine.pauseClock());
  ipcMain.handle('match:clockToggle', () => matchEngine.toggleClock());
  ipcMain.handle('match:clockReset', () => matchEngine.resetClock());
  ipcMain.handle('match:setClock', (_, data) =>
    matchEngine.setClock(data || {})
  );
  ipcMain.handle('match:setStartTime', (_, seconds) => matchEngine.setStartTime(seconds));
  ipcMain.handle('match:setTimerMode', (_, mode) => matchEngine.setTimerMode(mode));
  ipcMain.handle('match:setAdditionalTimeMode', (_, mode) => matchEngine.setAdditionalTimeMode(mode));
  ipcMain.handle('match:approveAdditionalTime', () => matchEngine.approveAdditionalTime());
  ipcMain.handle('match:setPeriod', (_, period) => matchEngine.setPeriod(period));
  ipcMain.handle('match:setBestOfSets', (_, count) => matchEngine.setBestOfSets(count));
  ipcMain.handle('match:adjustSetTally', (_, { team, amount }) => matchEngine.adjustSetTally(team, amount));
  ipcMain.handle('match:completeSet', (_, winner) => matchEngine.completeSet(winner));
  ipcMain.handle('match:removeCompletedSet', (_, setNumber) => matchEngine.removeCompletedSet(setNumber));
  ipcMain.handle('match:resetSets', () => matchEngine.resetSets());

  // --- Score IPC Handlers ---
  ipcMain.handle('score:get', () => scoreManager.getScore());
  ipcMain.handle('score:addHome', (_, amount) => scoreManager.addHome(amount));
  ipcMain.handle('score:subtractHome', (_, amount) => scoreManager.subtractHome(amount));
  ipcMain.handle('score:addAway', (_, amount) => scoreManager.addAway(amount));
  ipcMain.handle('score:subtractAway', (_, amount) => scoreManager.subtractAway(amount));
  ipcMain.handle('score:set', (_, { home, away }) => scoreManager.setScore(home, away));
  ipcMain.handle('score:reset', () => matchEngine.resetScoreAndSets());
  ipcMain.handle('score:updateTeams', (_, teamsData) => scoreManager.updateTeams(teamsData));

  // --- Events IPC Handlers ---
  ipcMain.handle('events:get', (_, limit) => eventLogger.getEvents(limit));
  ipcMain.handle('events:record', (_, { type, details }) => eventLogger.recordEvent(type, details));
  ipcMain.handle('events:clear', () => eventLogger.clearEvents());

  // --- Replay IPC Handlers ---
  ipcMain.handle('replay:getStatus', () => replayEngine.getStatus());

  // Operation A — Capture Replay: trigger Source Record's Save Replay Buffer hotkey.
  ipcMain.handle('replay:capture', async (_, options) => await replayEngine.captureReplay(options || {}));
  ipcMain.handle('replay:captureAll', async () => await replayEngine.captureAllReplays());
  ipcMain.handle('replay:air', async (_, clip) => await replayEngine.airReplay(clip));

  // --- Graphics IPC Handlers ---
  ipcMain.handle('graphics:showLowerThird', (_, data) => graphicsEngine.showLowerThird(data));
  ipcMain.handle('graphics:hideLowerThird', () => graphicsEngine.hideLowerThird());
  ipcMain.handle('graphics:getTopMessage', () => ({
    active: !!graphicsEngine.topMessageActive,
    data: graphicsEngine.topMessageData
  }));
  ipcMain.handle('graphics:showTopMessage', (_, data) => graphicsEngine.showTopMessage(data));
  ipcMain.handle('graphics:hideTopMessage', () => graphicsEngine.hideTopMessage());
  ipcMain.handle('graphics:getPresets', () => graphicsEngine.messages.getPresets());
  ipcMain.handle('graphics:getQueue', () => graphicsEngine.messages.getQueueState());
  ipcMain.handle('graphics:enqueue', (_, item) => graphicsEngine.messages.enqueue(item));
  ipcMain.handle('graphics:dequeue', () => graphicsEngine.messages.dequeue());
  ipcMain.handle('graphics:removeFromQueue', (_, id) => graphicsEngine.messages.removeItem(id));
  ipcMain.handle('graphics:clearQueue', () => graphicsEngine.messages.clearQueue());
  ipcMain.handle('graphics:triggerGoalAnimation', (_, { team, options }) =>
    graphicsEngine.triggerGoalAnimation(team, options)
  );
  ipcMain.handle('graphics:triggerTransition', (_, data) => graphicsEngine.triggerTransition(data));
  ipcMain.handle('graphics:getScorebugVisible', () => graphicsEngine.scorebugVisible);
  ipcMain.handle('graphics:setScorebugVisible', (_, visible) => graphicsEngine.setScorebugVisible(visible));

  // --- Goal Workflow IPC Handlers ---
  ipcMain.handle('goal:trigger', async (_, { team, options }) => await goalWorkflow.triggerGoal(team, options));
  ipcMain.handle('goal:goToReplay', () => goalWorkflow.goToReplay());
  ipcMain.handle('goal:continueToLive', async () => await goalWorkflow.continueToLive());
  ipcMain.handle('goal:abort', async () => await goalWorkflow.abort());
  ipcMain.handle('goal:getStatus', () => goalWorkflow.getStatus());

  // --- Master Safety / Return to Live ---
  ipcMain.handle('system:emergencyAbort', async () => {
    console.warn('[BOS-SYSTEM] EMERGENCY RETURN TO LIVE CALLED!');
    await goalWorkflow.abort();
    graphicsEngine.hideLowerThird();
    await scenesController.switchToLive();
    matchEngine.setTemporaryState('NONE');
    return true;
  });

  // --- Config IPC Handlers ---
  ipcMain.handle('config:get', (_, key) => configManager.get(key));
  ipcMain.handle('config:set', (_, { key, value }) => {
    configManager.set(key, value);
    return true;
  });
  ipcMain.handle('config:updateAll', (_, newConfig) => {
    configManager.updateAll(newConfig);
    return true;
  });
}

module.exports = registerIpcHandlers;
