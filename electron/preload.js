const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bosAPI', {
  // OBS
  obs: {
    connect: () => ipcRenderer.invoke('obs:connect'),
    disconnect: () => ipcRenderer.invoke('obs:disconnect'),
    getStatus: () => ipcRenderer.invoke('obs:getStatus'),
    getScenes: () => ipcRenderer.invoke('obs:getScenes'),
    switchScene: (name) => ipcRenderer.invoke('obs:switchScene', name),
    getTransitions: () => ipcRenderer.invoke('obs:getTransitions'),
    getCurrentTransition: () => ipcRenderer.invoke('obs:getCurrentTransition'),
    setTransition: (name) => ipcRenderer.invoke('obs:setTransition', name),
    setTransitionDuration: (ms) => ipcRenderer.invoke('obs:setTransitionDuration', ms),
    onStatusChanged: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('obs:statusChanged', cb);
      return () => ipcRenderer.removeListener('obs:statusChanged', cb);
    },
    onSceneChanged: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('obs:sceneChanged', cb);
      return () => ipcRenderer.removeListener('obs:sceneChanged', cb);
    },
    onPing: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('obs:ping', cb);
      return () => ipcRenderer.removeListener('obs:ping', cb);
    }
  },

  // Match
  match: {
    getState: () => ipcRenderer.invoke('match:getState'),
    setState: (state) => ipcRenderer.invoke('match:setState', state),
    clockStart: () => ipcRenderer.invoke('match:clockStart'),
    clockPause: () => ipcRenderer.invoke('match:clockPause'),
    clockToggle: () => ipcRenderer.invoke('match:clockToggle'),
    clockReset: () => ipcRenderer.invoke('match:clockReset'),
    setClock: (data) => ipcRenderer.invoke('match:setClock', data),
    setStartTime: (seconds) => ipcRenderer.invoke('match:setStartTime', seconds),
    setTimerMode: (mode) => ipcRenderer.invoke('match:setTimerMode', mode),
      setAdditionalTimeMode: (mode) => ipcRenderer.invoke('match:setAdditionalTimeMode', mode),
      approveAdditionalTime: () => ipcRenderer.invoke('match:approveAdditionalTime'),
    setPeriod: (p) => ipcRenderer.invoke('match:setPeriod', p),
    onClockTick: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('match:clockTick', cb);
      return () => ipcRenderer.removeListener('match:clockTick', cb);
    },
    onClockChanged: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('match:clockChanged', cb);
      return () => ipcRenderer.removeListener('match:clockChanged', cb);
    },
    onStateChanged: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('match:stateChanged', cb);
      return () => ipcRenderer.removeListener('match:stateChanged', cb);
    },
    onTempStateChanged: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('match:tempStateChanged', cb);
      return () => ipcRenderer.removeListener('match:tempStateChanged', cb);
    }
  },

  // Score
  score: {
    get: () => ipcRenderer.invoke('score:get'),
    addHome: (amt) => ipcRenderer.invoke('score:addHome', amt),
    subtractHome: (amt) => ipcRenderer.invoke('score:subtractHome', amt),
    addAway: (amt) => ipcRenderer.invoke('score:addAway', amt),
    subtractAway: (amt) => ipcRenderer.invoke('score:subtractAway', amt),
    set: (scores) => ipcRenderer.invoke('score:set', scores),
    reset: () => ipcRenderer.invoke('score:reset'),
    updateTeams: (data) => ipcRenderer.invoke('score:updateTeams', data),
    onChanged: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('score:changed', cb);
      return () => ipcRenderer.removeListener('score:changed', cb);
    },
    onTeamsUpdated: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('score:teamsUpdated', cb);
      return () => ipcRenderer.removeListener('score:teamsUpdated', cb);
    }
  },

  // Events
  events: {
    get: (limit) => ipcRenderer.invoke('events:get', limit),
    record: (type, details) => ipcRenderer.invoke('events:record', { type, details }),
    clear: () => ipcRenderer.invoke('events:clear'),
    onAdded: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('events:added', cb);
      return () => ipcRenderer.removeListener('events:added', cb);
    },
    onCleared: (callback) => {
      const cb = () => callback();
      ipcRenderer.on('events:cleared', cb);
      return () => ipcRenderer.removeListener('events:cleared', cb);
    }
  },

  // Replay
  // Replay (Source Record capture trigger)
  replay: {
    getStatus: () => ipcRenderer.invoke('replay:getStatus'),
    capture: (options) => ipcRenderer.invoke('replay:capture', options),
    captureAll: () => ipcRenderer.invoke('replay:captureAll'),
    air: (clip) => ipcRenderer.invoke('replay:air', clip),
    onStateChanged: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('replay:stateChanged', cb);
      return () => ipcRenderer.removeListener('replay:stateChanged', cb);
    }
  },

  // Graphics
  graphics: {
    showLowerThird: (data) => ipcRenderer.invoke('graphics:showLowerThird', data),
    hideLowerThird: () => ipcRenderer.invoke('graphics:hideLowerThird'),
    showTopMessage: (data) => ipcRenderer.invoke('graphics:showTopMessage', data),
    hideTopMessage: () => ipcRenderer.invoke('graphics:hideTopMessage'),
    getTopMessage: () => ipcRenderer.invoke('graphics:getTopMessage'),
    getPresets: () => ipcRenderer.invoke('graphics:getPresets'),
    getQueue: () => ipcRenderer.invoke('graphics:getQueue'),
    enqueue: (item) => ipcRenderer.invoke('graphics:enqueue', item),
    dequeue: () => ipcRenderer.invoke('graphics:dequeue'),
    removeFromQueue: (id) => ipcRenderer.invoke('graphics:removeFromQueue', id),
    clearQueue: () => ipcRenderer.invoke('graphics:clearQueue'),
    triggerGoalAnimation: (team, options) => ipcRenderer.invoke('graphics:triggerGoalAnimation', { team, options }),
    triggerTransition: (data) => ipcRenderer.invoke('graphics:triggerTransition', data),
    getScorebugVisible: () => ipcRenderer.invoke('graphics:getScorebugVisible'),
    setScorebugVisible: (visible) => ipcRenderer.invoke('graphics:setScorebugVisible', visible),
    onQueueUpdated: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('graphics:queueUpdated', cb);
      return () => ipcRenderer.removeListener('graphics:queueUpdated', cb);
    }
  },

  // Goal Workflow
  workflow: {
    triggerGoal: (team, options) => ipcRenderer.invoke('goal:trigger', { team, options }),
    continueToLive: () => ipcRenderer.invoke('goal:continueToLive'),
    abort: () => ipcRenderer.invoke('goal:abort'),
    getStatus: () => ipcRenderer.invoke('goal:getStatus'),
    onStarted: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('workflow:started', cb);
      return () => ipcRenderer.removeListener('workflow:started', cb);
    },
    onStep: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('workflow:step', cb);
      return () => ipcRenderer.removeListener('workflow:step', cb);
    },
    onCompleted: (callback) => {
      const cb = (_, data) => callback(data);
      ipcRenderer.on('workflow:completed', cb);
      return () => ipcRenderer.removeListener('workflow:completed', cb);
    },
    onAborted: (callback) => {
      const cb = () => callback();
      ipcRenderer.on('workflow:aborted', cb);
      return () => ipcRenderer.removeListener('workflow:aborted', cb);
    }
  },

  // Volleyball: isolated match state, rules, timeouts, sides, results, and announcements.
  volleyball: {
    getState: () => ipcRenderer.invoke('volleyball:getState'),
    createMatch: (setup) => ipcRenderer.invoke('volleyball:createMatch', setup),
    startMatch: () => ipcRenderer.invoke('volleyball:startMatch'),
    scorePoint: (teamId) => ipcRenderer.invoke('volleyball:scorePoint', teamId),
    undoLastPoint: (reason) => ipcRenderer.invoke('volleyball:undoLastPoint', reason),
    recordSetResult: (options) => ipcRenderer.invoke('volleyball:recordSetResult', options),
    advanceSet: () => ipcRenderer.invoke('volleyball:advanceSet'),
    startTimeout: (teamId, options) => ipcRenderer.invoke('volleyball:startTimeout', { teamId, options }),
    endTimeout: (reason) => ipcRenderer.invoke('volleyball:endTimeout', reason),
    cancelTimeout: (reason) => ipcRenderer.invoke('volleyball:cancelTimeout', reason),
    resolveTimeoutRecovery: (choice, reason) => ipcRenderer.invoke('volleyball:resolveTimeoutRecovery', { choice, reason }),
    switchSides: (options) => ipcRenderer.invoke('volleyball:switchSides', options),
    resolveSideSwitchPrompt: (action, options) => ipcRenderer.invoke('volleyball:resolveSideSwitchPrompt', { action, options }),
    undoLastSideSwitch: (reason) => ipcRenderer.invoke('volleyball:undoLastSideSwitch', reason),
    setAnnouncementLive: (text, requestId) => ipcRenderer.invoke('volleyball:setAnnouncementLive', { text, requestId }),
    clearAnnouncement: (announcementId) => ipcRenderer.invoke('volleyball:clearAnnouncement', announcementId),
    reopenCompletedMatch: (matchId, options) => ipcRenderer.invoke('volleyball:reopenCompletedMatch', { matchId, options }),
    correctSetScore: (setNumber, points, options) => ipcRenderer.invoke('volleyball:correctSetScore', { setNumber, points, options }),
    finalizeCorrection: (options) => ipcRenderer.invoke('volleyball:finalizeCorrection', options),
    onChanged: (callback) => {
      const cb = (_, state) => callback(state);
      ipcRenderer.on('volleyball:changed', cb);
      return () => ipcRenderer.removeListener('volleyball:changed', cb);
    }
  },

  // Basketball state is isolated from the Football match and score managers.
  basketball: {
    getState: () => ipcRenderer.invoke('basketball:getState'),
    createMatch: (setup) => ipcRenderer.invoke('basketball:createMatch', setup),
    toggleClock: () => ipcRenderer.invoke('basketball:toggleClock'),
    setClock: (seconds) => ipcRenderer.invoke('basketball:setClock', seconds),
    setPeriod: (period) => ipcRenderer.invoke('basketball:setPeriod', period),
    addScore: (side, points) => ipcRenderer.invoke('basketball:addScore', { side, points }),
    adjustScore: (side, delta) => ipcRenderer.invoke('basketball:adjustScore', { side, delta }),
    addFoul: (side) => ipcRenderer.invoke('basketball:addFoul', side),
    callTimeout: (side) => ipcRenderer.invoke('basketball:callTimeout', side),
    endTimeout: () => ipcRenderer.invoke('basketball:endTimeout'),
    setShotClock: (seconds) => ipcRenderer.invoke('basketball:setShotClock', seconds),
    setAnnouncement: (text) => ipcRenderer.invoke('basketball:setAnnouncement', text),
    clearAnnouncement: (id) => ipcRenderer.invoke('basketball:clearAnnouncement', id),
    onChanged: (callback) => {
      const cb = (_, state) => callback(state);
      ipcRenderer.on('basketball:changed', cb);
      return () => ipcRenderer.removeListener('basketball:changed', cb);
    }
  },

  // Emergency Safety Return to Live
  system: {
    emergencyAbort: () => ipcRenderer.invoke('system:emergencyAbort')
  },

  // Config
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', { key, value }),
    updateAll: (newConfig) => ipcRenderer.invoke('config:updateAll', newConfig)
  }
});
