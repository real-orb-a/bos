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
  goalWorkflow,
  volleyballEngine,
  basketballEngine
}) {
  const sendToRenderer = (channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  // Bind Subsystem Events to Renderer
  obsClient.on('connecting', () => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('connected', (status) => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('disconnected', () => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('streamStatusChanged', () => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('recordStatusChanged', () => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('sceneChanged', (scene) => sendToRenderer('obs:sceneChanged', scene));
  obsClient.on('ping', (latency) => sendToRenderer('obs:ping', latency));

  scoreManager.on('scoreChanged', (data) => sendToRenderer('score:changed', data));
  scoreManager.on('teamsUpdated', (data) => sendToRenderer('score:teamsUpdated', data));

  matchEngine.on('clockTick', (clock) => sendToRenderer('match:clockTick', clock));
  matchEngine.on('clockChanged', (clock) => sendToRenderer('match:clockChanged', clock));
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
  if (volleyballEngine) {
    volleyballEngine.on('changed', (state) => sendToRenderer('volleyball:changed', state));
  }
  if (basketballEngine) {
    basketballEngine.on('changed', (state) => sendToRenderer('basketball:changed', state));
  }

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

  // --- Score IPC Handlers ---
  ipcMain.handle('score:get', () => scoreManager.getScore());
  ipcMain.handle('score:addHome', (_, amount) => scoreManager.addHome(amount));
  ipcMain.handle('score:subtractHome', (_, amount) => scoreManager.subtractHome(amount));
  ipcMain.handle('score:addAway', (_, amount) => scoreManager.addAway(amount));
  ipcMain.handle('score:subtractAway', (_, amount) => scoreManager.subtractAway(amount));
  ipcMain.handle('score:set', (_, { home, away }) => scoreManager.setScore(home, away));
  ipcMain.handle('score:reset', () => scoreManager.resetScore());
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
  ipcMain.handle('goal:continueToLive', () => goalWorkflow.continueToLive());
  ipcMain.handle('goal:abort', async () => await goalWorkflow.abort());
  ipcMain.handle('goal:getStatus', () => goalWorkflow.getStatus());

  // --- Volleyball Domain IPC Handlers ---
  ipcMain.handle('volleyball:getState', () => volleyballEngine.getState());
  ipcMain.handle('volleyball:createMatch', (_, setup) => volleyballEngine.createMatch(setup));
  ipcMain.handle('volleyball:startMatch', () => volleyballEngine.startMatch());
  ipcMain.handle('volleyball:scorePoint', (_, teamId) => volleyballEngine.scorePoint(teamId));
  ipcMain.handle('volleyball:undoLastPoint', (_, reason) => volleyballEngine.undoLastPoint(reason));
  ipcMain.handle('volleyball:recordSetResult', (_, options) => volleyballEngine.recordSetResult(options || {}));
  ipcMain.handle('volleyball:advanceSet', () => volleyballEngine.advanceSet());
  ipcMain.handle('volleyball:startTimeout', (_, { teamId, options } = {}) => volleyballEngine.startTimeout(teamId, options || {}));
  ipcMain.handle('volleyball:endTimeout', (_, reason) => volleyballEngine.endTimeout(reason));
  ipcMain.handle('volleyball:cancelTimeout', (_, reason) => volleyballEngine.cancelTimeout(reason));
  ipcMain.handle('volleyball:resolveTimeoutRecovery', (_, { choice, reason } = {}) => volleyballEngine.resolveTimeoutRecovery(choice, reason));
  ipcMain.handle('volleyball:switchSides', (_, options) => volleyballEngine.switchSides(options || {}));
  ipcMain.handle('volleyball:resolveSideSwitchPrompt', (_, { action, options } = {}) => volleyballEngine.resolveSideSwitchPrompt(action, options || {}));
  ipcMain.handle('volleyball:undoLastSideSwitch', (_, reason) => volleyballEngine.undoLastSideSwitch(reason));
  ipcMain.handle('volleyball:setAnnouncementLive', (_, { text, requestId } = {}) => volleyballEngine.setAnnouncementLive(text, requestId));
  ipcMain.handle('volleyball:clearAnnouncement', (_, announcementId) => volleyballEngine.clearAnnouncement(announcementId));
  ipcMain.handle('volleyball:reopenCompletedMatch', (_, { matchId, options } = {}) => volleyballEngine.reopenCompletedMatch(matchId, options || {}));
  ipcMain.handle('volleyball:correctSetScore', (_, { setNumber, points, options } = {}) => volleyballEngine.correctSetScore(setNumber, points, options || {}));
  ipcMain.handle('volleyball:finalizeCorrection', (_, options) => volleyballEngine.finalizeCorrection(options || {}));

  // --- Basketball Domain IPC Handlers ---
  ipcMain.handle('basketball:getState', () => basketballEngine.getState());
  ipcMain.handle('basketball:createMatch', (_, setup) => basketballEngine.createMatch(setup));
  ipcMain.handle('basketball:toggleClock', () => basketballEngine.toggleClock());
  ipcMain.handle('basketball:setClock', (_, seconds) => basketballEngine.setClock(seconds));
  ipcMain.handle('basketball:setPeriod', (_, period) => basketballEngine.setPeriod(period));
  ipcMain.handle('basketball:addScore', (_, { side, points } = {}) => basketballEngine.addScore(side, points));
  ipcMain.handle('basketball:adjustScore', (_, { side, delta } = {}) => basketballEngine.adjustScore(side, delta));
  ipcMain.handle('basketball:addFoul', (_, side) => basketballEngine.addFoul(side));
  ipcMain.handle('basketball:callTimeout', (_, side) => basketballEngine.callTimeout(side));
  ipcMain.handle('basketball:endTimeout', () => basketballEngine.endTimeout());
  ipcMain.handle('basketball:setShotClock', (_, seconds) => basketballEngine.setShotClock(seconds));
  ipcMain.handle('basketball:setAnnouncement', (_, text) => basketballEngine.setAnnouncement(text));
  ipcMain.handle('basketball:clearAnnouncement', (_, id) => basketballEngine.clearAnnouncement(id));

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
  // The OBS password never travels to the renderer. config:get returns an empty
  // password plus a `passwordSet` flag; an empty password on save means "keep the
  // stored one". (To remove a password, edit config/bos.json directly.)
  const redactConfig = (value) => {
    if (!value || typeof value !== 'object') return value;
    const copy = JSON.parse(JSON.stringify(value));
    if (copy.obs && typeof copy.obs === 'object') {
      copy.obs.passwordSet = !!(copy.obs.password);
      copy.obs.password = '';
    }
    return copy;
  };

  ipcMain.handle('config:get', (_, key) => {
    const value = configManager.get(key);
    if (!key) return redactConfig(value);
    if (key === 'obs') return redactConfig({ obs: value }).obs;
    if (key === 'obs.password') return '';
    return value;
  });
  ipcMain.handle('config:set', (_, { key, value }) => {
    if (key === 'obs.password' && !value) return true; // empty = unchanged
    return configManager.set(key, value) !== false;
  });
  ipcMain.handle('config:updateAll', (_, newConfig) => {
    if (newConfig && newConfig.obs && typeof newConfig.obs === 'object') {
      const merged = { ...newConfig.obs };
      delete merged.passwordSet;
      if (!merged.password) {
        const existing = configManager.get('obs.password');
        if (existing) merged.password = existing;
        else delete merged.password;
      }
      newConfig = { ...newConfig, obs: merged };
    }
    return configManager.updateAll(newConfig) !== false;
  });
}

module.exports = registerIpcHandlers;
