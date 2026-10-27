const { ipcMain, dialog } = require('electron');
const path = require('path');

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
  sessionManager,
  loadTeamCatalog
}) {
  let selectedReplayPath = null;
  const sendToRenderer = (channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  ipcMain.handle('teams:getCatalog', () => loadTeamCatalog());
  ipcMain.handle('session:getState', () => sessionManager.getState());
  ipcMain.handle('session:create', (_, data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Session details are required.');
    }
    const teams = loadTeamCatalog();
    const findTeam = id => teams.find(team => team.id === id);
    const homeTeam = data.mode === 'athletics' ? null : findTeam(data.homeTeamId);
    const awayTeam = data.mode === 'athletics' ? null : findTeam(data.awayTeamId);
    if (data.mode !== 'athletics' && data.mode !== 'formal-event' && (!homeTeam || !awayTeam)) {
      throw new Error('Choose both teams from the configured team catalog.');
    }
    if (homeTeam && awayTeam && homeTeam.id === awayTeam.id) {
      throw new Error('Choose two different teams.');
    }
    const session = sessionManager.create({
      ...data,
      homeTeam: homeTeam?.name,
      awayTeam: awayTeam?.name,
      homeTeamBrand: homeTeam,
      awayTeamBrand: awayTeam,
      athleticsHouses: data.mode === 'athletics' ? teams : undefined
    });
    graphicsEngine.setScorebugMatchName(session.competition.name);
    if (session.teams) {
      const currentTeams = scoreManager.getScore();
      const scoreTeam = team => ({
        ...team,
        short: team.name.toLocaleLowerCase() === 'garnet' ? 'GAR'
          : team.name.toLocaleLowerCase() === 'emerald' ? 'EME'
            : team.name.toLocaleLowerCase() === 'topaz' ? 'TOP' : team.shortName || team.short,
        color: team.primaryColor || team.color
      });
      scoreManager.updateTeams({
        home: { ...currentTeams.home, ...scoreTeam(session.teams.home) },
        away: { ...currentTeams.away, ...scoreTeam(session.teams.away) }
      });
    }
    matchEngine.pauseClock();
    matchEngine.pauseOffenseClock();
    scoreManager.resetScore();
    matchEngine.resetSets();
    matchEngine.resetClock();
    matchEngine.setMatchState('PRE_MATCH');
    const clockConfig = {
      football: { mode: 'stopwatch', minutes: 90, period: '1st Half' },
      basketball: { mode: 'countdown', minutes: 10, period: '1st Quarter' },
      cricket: { mode: 'none', minutes: 90, period: '1st Innings' },
      netball: { mode: 'countdown', minutes: 15, period: '1st Quarter' },
      volleyball: { mode: 'none', minutes: 90, period: 'Set 1' },
      'table-tennis': { mode: 'none', minutes: 90, period: 'Game 1' },
      badminton: { mode: 'none', minutes: 90, period: 'Game 1' },
      athletics: { mode: 'stopwatch', minutes: 90, period: 'Event' },
      'formal-event': { mode: 'none', minutes: 90, period: 'Programme' }
    }[session.modeId];
    matchEngine.setTimerMode(clockConfig.mode);
    matchEngine.setClock({ regulationMinutes: clockConfig.minutes });
    matchEngine.setStartTime(clockConfig.mode === 'countdown' ? clockConfig.minutes * 60 : 0);
    matchEngine.setPeriod(clockConfig.period);
    if (obsClient.getStatus().stream.active) sessionManager.updateStatus('LIVE');
    graphicsEngine.setScorebugVisible(!['athletics', 'formal-event'].includes(session.modeId));
    graphicsEngine.setScorebugExpanded(false);
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    graphicsEngine.setSportScorebugState(session);
    return session;
  });
  ipcMain.handle('session:activate', () => sessionManager.activate());
  ipcMain.handle('session:resume', () => {
    const session = sessionManager.resume();
    graphicsEngine.setScorebugVisible(!['athletics', 'formal-event'].includes(session.modeId));
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    graphicsEngine.setScorebugMatchName(session.competition.name);
    graphicsEngine.setSportScorebugState(session);
    return session;
  });
  ipcMain.handle('session:discard', () => {
    const session = sessionManager.discard();
    graphicsEngine.setSportScorebugState(null);
    return session;
  });
  ipcMain.handle('session:end', () => {
    const session = sessionManager.end();
    graphicsEngine.setSportScorebugState(null);
    return session;
  });
  ipcMain.handle('session:addParticipant', (_, input) => sessionManager.addParticipant(input));
  ipcMain.handle('session:updateCompetitionName', (_, name) => {
    const session = sessionManager.updateCompetitionName(name);
    graphicsEngine.setScorebugMatchName(session.competition.name);
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    return session;
  });
  ipcMain.handle('session:removeParticipant', (_, id) => sessionManager.removeParticipant(id));
  ipcMain.handle('session:setTeamLogo', (_, { side, dataUrl }) => {
    const session = sessionManager.setTeamLogo(side, dataUrl);
    scoreManager.updateTeams({ [side]: { logo: dataUrl } });
    return session;
  });
  ipcMain.handle('session:updateSportState', (_, patch) => {
    const session = sessionManager.updateSportState(patch);
    graphicsEngine.setSportScorebugState(session);
    return session;
  });
  ipcMain.handle('session:applyScoreChange', (_, { side, amount }) => {
    const outcome = sessionManager.applyScoreChange(side, amount, scoreManager, eventLogger);
    if (outcome.completed && outcome.session.modeId === 'volleyball') {
      matchEngine.adjustSetTally(outcome.completed.winner, 1);
    }
    graphicsEngine.setSportScorebugState(outcome.session);
    return outcome;
  });
  ipcMain.handle('session:setAthleticsEvent', (_, input) => {
    const session = sessionManager.setAthleticsEvent(input);
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    return session;
  });
  ipcMain.handle('session:setAthleticsPodiumVisible', (_, visible) => {
    const session = sessionManager.setAthleticsPodiumVisible(visible);
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    return session;
  });
  ipcMain.handle('session:recordAthleticsResult', (_, input) => {
    const session = sessionManager.recordAthleticsResult(input);
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    return session;
  });
  ipcMain.handle('session:removeAthleticsResult', (_, resultId) => {
    const session = sessionManager.removeAthleticsResult(resultId);
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    return session;
  });
  ipcMain.handle('session:getAthleticsStandings', () => sessionManager.getAthleticsStandings());
  ipcMain.handle('session:addAthleticsHouse', (_, input) => {
    const session = sessionManager.addAthleticsHouse(input);
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    return session;
  });
  ipcMain.handle('session:setAthleticsHouseLogo', (_, { houseId, dataUrl }) => {
    const session = sessionManager.setAthleticsHouseLogo(houseId, dataUrl);
    graphicsEngine.setAthleticsStandings(sessionManager.getAthleticsBroadcastState());
    return session;
  });

  // Bind Subsystem Events to Renderer
  obsClient.on('connected', (status) => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('disconnected', () => sendToRenderer('obs:statusChanged', obsClient.getStatus()));
  obsClient.on('sceneChanged', (scene) => sendToRenderer('obs:sceneChanged', scene));
  obsClient.on('ping', (latency) => sendToRenderer('obs:ping', latency));

  scoreManager.on('scoreChanged', (data) => sendToRenderer('score:changed', data));
  scoreManager.on('teamsUpdated', (data) => sendToRenderer('score:teamsUpdated', data));

  matchEngine.on('clockTick', (clock) => sendToRenderer('match:clockTick', clock));
  matchEngine.on('clockChanged', (clock) => sendToRenderer('match:clockChanged', clock));
  matchEngine.on('offenseTick', (state) => sendToRenderer('match:offenseTick', state));
  matchEngine.on('offenseChanged', (state) => sendToRenderer('match:offenseChanged', state));
  matchEngine.on('setsChanged', (sets) => sendToRenderer('match:setsChanged', sets));
  matchEngine.on('stateChanged', (state) => sendToRenderer('match:stateChanged', state));
  matchEngine.on('temporaryStateChanged', (state) => sendToRenderer('match:tempStateChanged', state));

  eventLogger.on('eventAdded', (evt) => sendToRenderer('events:added', evt));
  eventLogger.on('eventsCleared', () => sendToRenderer('events:cleared'));

  replayEngine.on('replayStateChanged', (status) => sendToRenderer('replay:stateChanged', status));

  graphicsEngine.on('queueUpdated', (q) => sendToRenderer('graphics:queueUpdated', q));
  graphicsEngine.on('remoteScoreProposalsChanged', (proposals) =>
    sendToRenderer('graphics:remoteScoreProposalsChanged', proposals)
  );

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
  ipcMain.handle('match:setOffenseClock', (_, data) => matchEngine.setOffenseClock(data || {}));
  ipcMain.handle('match:setOffenseClockEnabled', (_, enabled) => matchEngine.setOffenseClockEnabled(enabled));
  ipcMain.handle('match:startOffenseClock', () => matchEngine.startOffenseClock());
  ipcMain.handle('match:pauseOffenseClock', () => matchEngine.pauseOffenseClock());
  ipcMain.handle('match:toggleOffenseClock', () => matchEngine.toggleOffenseClock());
  ipcMain.handle('match:resetOffenseClock', () => matchEngine.resetOffenseClock());
  ipcMain.handle('match:getOffenseState', () => matchEngine.getOffenseClockState());
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
  ipcMain.handle('replay:chooseFile', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a saved replay',
      properties: ['openFile'],
      filters: [{
        name: 'Video files',
        extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'ts']
      }]
    });
    if (selection.canceled || selection.filePaths.length === 0) return null;
    selectedReplayPath = path.resolve(selection.filePaths[0]);
    return path.basename(selectedReplayPath);
  });
  ipcMain.handle('replay:air', async () => {
    if (!selectedReplayPath) throw new Error('Select a replay video first.');
    return replayEngine.airReplay(selectedReplayPath);
  });
  ipcMain.handle('replay:stop', async () => await replayEngine.stopReplay());

  // --- Graphics IPC Handlers ---
  ipcMain.handle('graphics:showLowerThird', (_, data) => graphicsEngine.showLowerThird(data));
  ipcMain.handle('graphics:hideLowerThird', () => graphicsEngine.hideLowerThird());
  ipcMain.handle('graphics:getTopMessage', () => ({
    active: !!graphicsEngine.topMessageActive,
    data: graphicsEngine.topMessageData
  }));
  ipcMain.handle('graphics:showTopMessage', (_, data) => graphicsEngine.showTopMessage(data));
  ipcMain.handle('graphics:hideTopMessage', () => graphicsEngine.hideTopMessage());
  ipcMain.handle('graphics:getPresets', () => graphicsEngine.messages.getPresets(scoreManager.getScore()));
  ipcMain.handle('graphics:getQueue', () => graphicsEngine.messages.getQueueState());
  ipcMain.handle('graphics:enqueue', (_, item) => graphicsEngine.enqueueMessage(item));
  ipcMain.handle('graphics:dequeue', () => graphicsEngine.messages.dequeue());
  ipcMain.handle('graphics:removeFromQueue', (_, id) => graphicsEngine.messages.removeItem(id));
  ipcMain.handle('graphics:clearQueue', () => graphicsEngine.messages.clearQueue());
  ipcMain.handle('graphics:triggerGoalAnimation', (_, { team, options }) =>
    graphicsEngine.triggerGoalAnimation(team, options)
  );
  ipcMain.handle('graphics:triggerTransition', (_, data) => graphicsEngine.triggerTransition(data));
  ipcMain.handle('graphics:getScorebugVisible', () => graphicsEngine.scorebugVisible);
  ipcMain.handle('graphics:setScorebugVisible', (_, visible) => graphicsEngine.setScorebugVisible(visible));
  ipcMain.handle('graphics:setScorebugExpanded', (_, expanded) =>
    graphicsEngine.setScorebugExpanded(expanded)
  );
  ipcMain.handle('graphics:getScreenCenterScorebugVisible', () =>
    graphicsEngine.screenCenterScorebugVisible
  );
  ipcMain.handle('graphics:setScreenCenterScorebugVisible', (_, visible) =>
    graphicsEngine.setScreenCenterScorebugVisible(visible)
  );
  ipcMain.handle('graphics:getRemoteControlInfo', () => graphicsEngine.getRemoteControlInfo());
  ipcMain.handle('graphics:setRemoteControlPassword', (_, password) => graphicsEngine.setRemoteControlPassword(password));
  ipcMain.handle('graphics:setRemoteImmediateScore', (_, enabled) => graphicsEngine.setRemoteImmediateScore(enabled));
  ipcMain.handle('graphics:getRemoteScoreProposals', () => graphicsEngine.getRemoteScoreProposals());
  ipcMain.handle('graphics:approveRemoteScoreProposal', (_, id) => graphicsEngine.approveRemoteScoreProposal(id));
  ipcMain.handle('graphics:rejectRemoteScoreProposal', (_, id) => graphicsEngine.rejectRemoteScoreProposal(id));

  // --- Goal Workflow IPC Handlers ---
  ipcMain.handle('goal:trigger', async (_, { team, options }) => await goalWorkflow.triggerGoal(team, options));
  ipcMain.handle('goal:goToReplay', () => goalWorkflow.goToReplay());
  ipcMain.handle('goal:continueToLive', async () => await goalWorkflow.continueToLive());
  ipcMain.handle('goal:abort', async () => await goalWorkflow.abort());
  ipcMain.handle('goal:getStatus', () => goalWorkflow.getStatus());

  // --- Master Safety / Return to Live ---
  ipcMain.handle('system:emergencyAbort', async () => {
    console.warn('[SLC-SYSTEM] EMERGENCY RETURN TO LIVE CALLED!');
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
