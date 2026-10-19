(function() {
  const authPanel = document.getElementById('auth-panel');
  const authForm = document.getElementById('auth-form');
  const accessKeyInput = document.getElementById('access-key');
  const authError = document.getElementById('auth-error');
  const controls = document.getElementById('controls');
  const connectionStatus = document.getElementById('connection-status');
  const controlFeedback = document.getElementById('control-feedback');
  const matchClock = document.getElementById('match-clock');
  const matchPeriod = document.getElementById('match-period');
  const matchClockCard = document.getElementById('match-clock-card');
  const clockAdjustPanel = document.getElementById('clock-adjust-panel');
  const clockAdjustRange = document.getElementById('clock-adjust-range');
  const clockAdjustValue = document.getElementById('clock-adjust-value');
  const clockStartValue = document.getElementById('clock-start-value');
  const periodLabelInput = document.getElementById('period-label-input');
  const offenseCard = document.getElementById('offense-card');
  const offenseClock = document.getElementById('offense-clock');
  const clockToggle = document.getElementById('btn-clock-toggle');
  const offenseToggle = document.getElementById('btn-offense-toggle');
  const setTally = document.getElementById('set-tally');
  const submitScoreRequest = document.getElementById('btn-submit-score-request');
  const pendingScoreLabel = document.getElementById('pending-score-label');
  const accessKeyVisibility = document.getElementById('btn-toggle-access-key');
  const scoreModeStatus = document.getElementById('score-mode-status');

  let socket = null;
  let authenticated = false;
  let blockAutomaticAuth = false;
  let timerMode = null;
  let immediateScore = false;
  const pendingScore = { home: 0, away: 0 };
  const currentScore = { home: 0, away: 0 };

  authForm.addEventListener('submit', (event) => {
    event.preventDefault();
    blockAutomaticAuth = false;
    authError.textContent = '';
    requestAuthentication();
  });

  document.querySelectorAll('.score-buttons button').forEach((button) => {
    button.addEventListener('click', () => {
      const team = button.dataset.team;
      const amount = Number(button.dataset.amount);
      if (immediateScore) {
        sendCommand('SCORE_ADJUST', { team, amount });
        return;
      }
      pendingScore[team] += amount;
      renderScorePreview();
    });
  });

  accessKeyVisibility.addEventListener('click', () => {
    const reveal = accessKeyInput.type === 'password';
    accessKeyInput.type = reveal ? 'text' : 'password';
    accessKeyVisibility.textContent = reveal ? 'HIDE' : 'SHOW';
    accessKeyVisibility.setAttribute('aria-pressed', String(reveal));
  });

  submitScoreRequest.addEventListener('click', () => {
    submitScoreRequest.disabled = true;
    sendCommand('SCORE_PROPOSAL', {
      homeDelta: pendingScore.home,
      awayDelta: pendingScore.away
    });
  });

  clockToggle.addEventListener('click', () => sendCommand('CLOCK_TOGGLE'));
  document.getElementById('btn-clock-reset').addEventListener('click', () => sendCommand('CLOCK_RESET'));
  offenseToggle.addEventListener('click', () => sendCommand('OFFENSE_TOGGLE'));
  document.getElementById('btn-offense-reset').addEventListener('click', () => sendCommand('OFFENSE_RESET'));
  clockAdjustRange.addEventListener('input', () => {
    clockAdjustValue.value = formatClock(Number(clockAdjustRange.value));
  });
  document.getElementById('btn-set-clock').addEventListener('click', () => {
    const seconds = parseClock(clockAdjustValue.value);
    if (seconds === null) {
      controlFeedback.textContent = 'Enter clock time as MM:SS.';
      return;
    }
    sendCommand('CLOCK_SET', { seconds });
  });
  document.getElementById('btn-set-start-time').addEventListener('click', () => {
    const seconds = parseClock(clockStartValue.value);
    if (seconds === null) {
      controlFeedback.textContent = 'Enter start time as MM:SS.';
      return;
    }
    sendCommand('CLOCK_SET_START', { seconds });
  });
  document.getElementById('btn-set-period').addEventListener('click', () => {
    const period = periodLabelInput.value.trim();
    if (!period || period.length > 24) {
      controlFeedback.textContent = 'Period label must contain 1 to 24 characters.';
      return;
    }
    sendCommand('CLOCK_SET_PERIOD', { period });
  });

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener('open', () => {
      connectionStatus.textContent = 'CONNECTED';
      if (accessKeyInput.value && !blockAutomaticAuth) requestAuthentication();
    });
    socket.addEventListener('message', ({ data }) => {
      try {
        handleMessage(JSON.parse(data));
      } catch (error) {
        console.error('[BOS Remote] Invalid server message:', error);
      }
    });
    socket.addEventListener('close', () => {
      authenticated = false;
      controls.hidden = true;
      authPanel.hidden = false;
      connectionStatus.textContent = 'RECONNECTING';
      connectionStatus.classList.remove('connected');
      setTimeout(connect, 1500);
    });
    socket.addEventListener('error', () => {
      connectionStatus.textContent = 'CONNECTION ERROR';
      connectionStatus.classList.remove('connected');
    });
  }

  function requestAuthentication() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      authError.textContent = 'Waiting for connection. Try again in a moment.';
      return;
    }
    socket.send(JSON.stringify({ type: 'REMOTE_AUTH', password: accessKeyInput.value }));
  }

  function sendCommand(action, values = {}) {
    if (!authenticated || !socket || socket.readyState !== WebSocket.OPEN) {
      controlFeedback.textContent = 'Remote is disconnected. Reconnect before controlling the match.';
      return;
    }
    socket.send(JSON.stringify({ type: 'REMOTE_COMMAND', action, ...values }));
    controlFeedback.textContent = action === 'SCORE_ADJUST' ? 'Score update sent.' : '';
    if (action === 'SCORE_PROPOSAL') submitScoreRequest.disabled = true;
  }

  function handleMessage(message) {
    if (message.type === 'INITIAL_SYNC') {
      immediateScore = message.remoteImmediateScore === true;
      renderScoreMode();
      if (message.score) renderScore(message.score);
      if (message.score && message.score.sets) renderSets(message.score.sets);
      if (message.score && message.score.clock) renderClock(message.score.clock);
      if (message.offense) renderOffense(message.offense);
      return;
    }
    if (message.type === 'REMOTE_SCORE_MODE') {
      immediateScore = message.immediate === true;
      renderScoreMode();
      renderScorePreview();
      return;
    }
    if (message.type === 'REMOTE_AUTH_RESULT') {
      authenticated = !!message.authenticated;
      if (authenticated) {
        blockAutomaticAuth = false;
        authPanel.hidden = true;
        controls.hidden = false;
        authError.textContent = '';
        connectionStatus.textContent = 'REMOTE UNLOCKED';
        connectionStatus.classList.add('connected');
      } else {
        blockAutomaticAuth = true;
        authError.textContent = 'That password was not accepted. Check the password in BOS and try again.';
      }
      return;
    }
    if (message.type === 'REMOTE_AUTH_REQUIRED') {
      authenticated = false;
      blockAutomaticAuth = true;
      accessKeyInput.value = '';
      authPanel.hidden = false;
      controls.hidden = true;
      authError.textContent = 'The remote password changed. Enter the new password to continue.';
      connectionStatus.textContent = 'AUTH REQUIRED';
      connectionStatus.classList.remove('connected');
      return;
    }
    if (message.type === 'SCORE_UPDATE') {
      renderScore(message);
      if (message.clock) renderClock(message.clock);
      if (message.sets) renderSets(message.sets);
      return;
    }
    if (message.type === 'CLOCK_UPDATE') {
      renderClock(message.clock);
      return;
    }
    if (message.type === 'SETS_UPDATE') {
      renderSets(message.sets);
      return;
    }
    if (message.type === 'OFFENSE_UPDATE') {
      renderOffense(message.offense);
      return;
    }
    if (message.type === 'REMOTE_COMMAND_RESULT' && !message.ok) {
      controlFeedback.textContent = message.error || 'Control command failed.';
      if (message.action === 'SCORE_PROPOSAL') renderScorePreview();
    } else if (message.type === 'REMOTE_COMMAND_RESULT' && message.ok) {
      if (message.action === 'SCORE_PROPOSAL') {
        pendingScore.home = 0;
        pendingScore.away = 0;
        renderScorePreview();
        controlFeedback.textContent = 'Score request sent to BOS for approval.';
      } else if (message.action === 'SCORE_ADJUST') {
        controlFeedback.textContent = 'Score updated immediately.';
      } else if (message.action === 'CLOCK_SET') {
        controlFeedback.textContent = 'Match clock updated.';
      } else if (message.action === 'CLOCK_SET_START') {
        controlFeedback.textContent = 'Clock start time saved.';
      } else if (message.action === 'CLOCK_SET_PERIOD') {
        controlFeedback.textContent = 'Period label updated.';
      }
    }
  }

  function renderScore(data) {
    ['home', 'away'].forEach((team) => {
      if (!data[team]) return;
      document.getElementById(`${team}-name`).textContent = data[team].name || team.toUpperCase();
      currentScore[team] = Number(data[team].score) || 0;
      document.getElementById(`${team}-row`).style.borderLeftColor = data[team].color || 'transparent';
    });
    renderScorePreview();
  }

  function renderScorePreview() {
    ['home', 'away'].forEach((team) => {
      const score = Math.max(0, currentScore[team] + pendingScore[team]);
      document.getElementById(`${team}-score`).textContent =
        pendingScore[team] ? `${score}*` : String(score);
    });
    const hasChanges = pendingScore.home !== 0 || pendingScore.away !== 0;
    submitScoreRequest.disabled = !hasChanges || !authenticated;
    submitScoreRequest.hidden = immediateScore || !hasChanges;
    pendingScoreLabel.hidden = !hasChanges;
    const homeDelta = pendingScore.home > 0 ? `+${pendingScore.home}` : pendingScore.home;
    const awayDelta = pendingScore.away > 0 ? `+${pendingScore.away}` : pendingScore.away;
    pendingScoreLabel.textContent =
      `Requested change: home ${homeDelta}, away ${awayDelta}. BOS must approve it.`;
  }

  function renderScoreMode() {
    scoreModeStatus.textContent = immediateScore
      ? 'Score changes apply immediately.'
      : 'Score changes require approval.';
  }

  function renderSets(sets) {
    if (!sets) return;
    setTally.textContent = `SETS ${sets.homeSets ?? 0}–${sets.awaySets ?? 0}`;
  }

  function renderClock(clock) {
    if (!clock) return;
    const noClock = clock.mode === 'none';
    timerMode = clock.mode;
    matchClockCard.hidden = noClock;
    clockAdjustPanel.hidden = noClock;
    setTally.hidden = !noClock;
    matchClock.textContent = clock.formatted || '00:00';
    matchPeriod.textContent = clock.period ? clock.period.toUpperCase() : '';
    clockAdjustRange.max = String(clock.regulationSeconds ?? 5400);
    if (document.activeElement !== clockAdjustRange) {
      clockAdjustRange.value = String(clock.elapsedSeconds ?? 0);
    }
    if (document.activeElement !== clockAdjustValue) {
      clockAdjustValue.value = clock.formatted === 'NO TIME'
        ? formatClock(clock.elapsedSeconds ?? 0)
        : (clock.formatted || '00:00');
    }
    if (document.activeElement !== clockStartValue) {
      clockStartValue.value = formatClock(clock.startSeconds ?? 0);
    }
    if (document.activeElement !== periodLabelInput) {
      periodLabelInput.value = clock.period || '';
    }
    clockToggle.textContent = clock.running ? 'PAUSE' : 'START';
    clockToggle.disabled = noClock;
    if (clock.offenseTimer || clock.offense) renderOffense(clock.offenseTimer || clock.offense);
  }

  function renderOffense(offense) {
    if (!offense) return;
    offenseCard.hidden = timerMode !== 'countdown' ||
      !(offense.active || Number(offense.limitSeconds) > 0);
    offenseClock.textContent = offense.seconds ?? offense.elapsedSeconds ?? 0;
    offenseToggle.textContent = offense.running ? 'PAUSE' : 'START';
  }

  function parseClock(value) {
    const match = String(value).trim().match(/^(\d{1,3}):([0-5]\d)$/);
    if (!match) return null;
    const seconds = Number(match[1]) * 60 + Number(match[2]);
    return seconds <= Number(clockAdjustRange.max) ? seconds : null;
  }

  function formatClock(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  connect();
})();
