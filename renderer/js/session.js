document.addEventListener('DOMContentLoaded', async () => {
  const launchScreen = document.getElementById('slc-launch-screen');
  const homeStep = document.getElementById('slc-home-step');
  const modeStep = document.getElementById('slc-mode-step');
  const setupStep = document.getElementById('slc-setup-step');
  const teamSetup = document.querySelector('.slc-team-setup');
  const tableTennisSetup = document.getElementById('slc-table-tennis-setup');
  const formError = document.getElementById('slc-form-error');
  const sessionOpsPanel = document.getElementById('session-ops-panel');
  const sessionFeedback = document.getElementById('session-ops-feedback');
  const sessionModes = {
    football: { title: 'FOOTBALL CONTROL', period: 'Half' },
    basketball: { title: 'BASKETBALL CONTROL', period: 'Quarter' },
    cricket: { title: 'CRICKET CONTROL', period: 'Innings' },
    netball: { title: 'NETBALL CONTROL', period: 'Quarter' },
    volleyball: { title: 'VOLLEYBALL CONTROL', period: 'Set' },
    'table-tennis': { title: 'TABLE TENNIS CONTROL', period: 'Game' },
    badminton: { title: 'BADMINTON CONTROL', period: 'Game' },
    athletics: { title: 'ATHLETICS CONTROL', period: 'Event' },
    'formal-event': { title: 'FORMAL EVENT CONTROL', period: 'Programme' }
  };
  let currentSession = null;
  let selectedReplayName = '';
  let scorebugExpanded = false;
  let teamCatalog = [];
  const modes = [
    ['football', 'Football'],
    ['basketball', 'Basketball'],
    ['cricket', 'Cricket'],
    ['netball', 'Netball'],
    ['volleyball', 'Volleyball'],
    ['table-tennis', 'Table Tennis'],
    ['badminton', 'Badminton'],
    ['athletics', 'Athletics'],
    ['formal-event', 'Formal Event']
  ];
  let selectedMode = null;
  let recoverableSession = null;
  const houseColors = {
    Garnet: '#e11d48',
    Emerald: '#10b981',
    Topaz: '#eab308'
  };

  const tableTennisFormat = document.getElementById('slc-table-tennis-format');
  const updateTableTennisSetup = () => {
    const doubles = tableTennisFormat.value === 'doubles';
    for (const side of ['home', 'away']) {
      const starter = document.getElementById(`slc-table-tennis-${side}-player-1`);
      const partner = document.getElementById(`slc-table-tennis-${side}-player-2`);
      partner.classList.toggle('hidden', !doubles);
      starter.required = selectedMode === 'table-tennis';
      partner.required = selectedMode === 'table-tennis' && doubles;
      if (!doubles) partner.value = '';
    }
  };
  tableTennisFormat.addEventListener('change', updateTableTennisSetup);
  updateTableTennisSetup();

  const updateHouseSwatch = side => {
    const teamSelect = document.getElementById(`slc-${side}-team`);
    const colorMark = document.getElementById(`slc-${side}-team-color`);
    const logo = document.getElementById(`slc-${side}-team-logo`);
    const team = teamCatalog.find(item => item.id === teamSelect.value);
    colorMark.style.setProperty('--house-color', team?.primaryColor || houseColors.Garnet);
    logo.src = team?.logo || '';
    logo.classList.toggle('hidden', !team?.logo);
  };

  try {
    teamCatalog = await window.slcAPI.teams.getCatalog();
    for (const side of ['home', 'away']) {
      const teamSelect = document.getElementById(`slc-${side}-team`);
      teamSelect.replaceChildren();
      teamCatalog.forEach(team => {
        const option = document.createElement('option');
        option.value = team.id;
        option.textContent = team.name;
        teamSelect.appendChild(option);
      });
    }
    document.getElementById('slc-away-team').value =
      teamCatalog.find(team => team.id === 'topaz')?.id || teamCatalog[1]?.id || '';
  } catch (error) {
    document.getElementById('slc-health-message').textContent = error.message || 'Team catalog could not be loaded.';
    document.getElementById('slc-create-session').disabled = true;
  }

  for (const side of ['home', 'away']) {
    const teamSelect = document.getElementById(`slc-${side}-team`);
    teamSelect.addEventListener('change', () => updateHouseSwatch(side));
    if (teamCatalog.length) updateHouseSwatch(side);
  }

  const showStep = step => {
    homeStep.classList.toggle('hidden', step !== 'home');
    modeStep.classList.toggle('hidden', step !== 'modes');
    setupStep.classList.toggle('hidden', step !== 'setup');
  };

  const formatSessionSummary = session => {
    const competition = session.competition || {};
    const values = [
      competition.name || 'Untitled session',
      session.modeId === 'formal-event' ? 'Formal Event' : (session.sportId || 'Sport'),
      competition.venue,
      session.snapshot?.score
        ? `${session.snapshot.score.home.name} ${session.snapshot.score.home.score} – ${session.snapshot.score.away.score} ${session.snapshot.score.away.name}`
        : null,
      session.snapshot?.match?.clock?.formatted,
      session.status
    ];
    return values.filter(Boolean).join(' · ');
  };

  const setActiveSession = session => {
    currentSession = session;
    document.body.dataset.activeMode = session.modeId;
    launchScreen.classList.add('hidden');
    sessionOpsPanel.classList.remove('hidden');
    const contextBanner = document.getElementById('session-context-banner');
    const isFootball = session.modeId === 'football';
    const isFormalEvent = session.modeId === 'formal-event';
    const isAthletics = session.modeId === 'athletics';
    const hasMatchClock = ['football', 'basketball', 'netball', 'athletics'].includes(session.modeId);
    const legacyMatchControls = document.querySelector('.col-match');
    const operatorWorkspace = document.querySelector('.operator-workspace');
    const athleticsDashboard = document.getElementById('athletics-dashboard');
    const athleticsSideRail = document.querySelector('.athletics-side-rail');
    if (isFootball) {
      document.getElementById('football-controls-slot').appendChild(legacyMatchControls);
    } else {
      operatorWorkspace.appendChild(legacyMatchControls);
      legacyMatchControls.classList.add('hidden');
    }
    legacyMatchControls.classList.toggle('hidden', !isFootball);
    document.querySelector('.col-replay').classList.add('hidden');
    document.getElementById('session-scoreboard').classList.toggle('hidden', isFormalEvent || isAthletics || isFootball);
    document.getElementById('session-scorebug-toggle').classList.toggle('hidden', isFormalEvent);
    document.getElementById('session-scorebug-toggle').textContent =
      isAthletics ? 'EXPAND STANDINGS' : 'EXPAND SCOREBUG';
    const scorebugToggle = document.getElementById('session-scorebug-toggle');
    const scorebugToggleAnchor = document.getElementById('scorebug-toggle-anchor');
    const footballScorebugToggleAnchor = document.getElementById('football-scorebug-toggle-anchor');
    const clockControls = document.getElementById('session-clock-controls');
    const clockControlsAnchor = document.getElementById('session-clock-controls-anchor');
    const replayOperations = document.getElementById('replay-operations');
    const replayOperationsAnchor = document.getElementById('replay-operations-anchor');
    const graphicsControls = document.querySelector('.col-graphics');
    const graphicsControlsAnchor = document.getElementById('graphics-controls-anchor');
    if (isAthletics) {
      athleticsDashboard.classList.remove('hidden');
      document.getElementById('athletics-tools').classList.remove('hidden');
      operatorWorkspace.appendChild(athleticsSideRail);
      document.getElementById('athletics-scorebug-toggle-slot').appendChild(scorebugToggle);
      document.getElementById('athletics-match-controls-slot').appendChild(clockControls);
      document.getElementById('athletics-replay-slot').appendChild(replayOperations);
      document.getElementById('athletics-messages-slot').appendChild(graphicsControls);
    } else {
      athleticsDashboard.classList.add('hidden');
      athleticsDashboard.appendChild(athleticsSideRail);
      if (isFootball) footballScorebugToggleAnchor.after(scorebugToggle);
      else scorebugToggleAnchor.after(scorebugToggle);
      clockControlsAnchor.after(clockControls);
      replayOperationsAnchor.before(replayOperations);
      graphicsControlsAnchor.after(graphicsControls);
    }
    document.getElementById('replay-operations').classList.toggle('hidden', isFormalEvent);
    scorebugExpanded = false;
    window.slcAPI.graphics.setScorebugExpanded(false).catch(reportSessionError);
    document.getElementById('session-clock-controls').classList.toggle('hidden', !hasMatchClock || isFootball);
    document.getElementById('session-sport-stats').classList.toggle('hidden', isFootball || isFormalEvent || isAthletics);
    document.getElementById('session-volleyball-rules').classList.toggle('hidden', session.modeId !== 'volleyball');
    document.getElementById('session-participants-tools').classList.toggle('hidden', !isFormalEvent);
    document.getElementById('formal-event-tools').classList.toggle('hidden', !isFormalEvent);
    document.getElementById('athletics-tools').classList.toggle('hidden', session.modeId !== 'athletics');
    contextBanner.classList.toggle('hidden', isFootball);
    document.getElementById('session-context-title').textContent =
      `${session.competition.name} · ${session.modeId.replace(/-/g, ' ').toUpperCase()}`;
    document.getElementById('session-context-description').textContent =
      isFormalEvent
        ? 'Formal-event cues and graphics are available. Match controls and the scorebug are hidden.'
        : isFootball
          ? 'Football match controls, official score, graphics, and replay operations are active.'
          : isAthletics
            ? 'Event standings and the event clock stay in the main workspace; notices and replay controls are together in the side panel.'
            : `${sessionModes[session.modeId].title}. Score, period, replay, and graphics state are session-specific.`;
    document.getElementById('btn-end-session').classList.remove('hidden');
    document.getElementById('program-text').textContent = `PROGRAM: ${session.status}`;
    document.getElementById('session-ops-title').textContent = sessionModes[session.modeId].title;
    document.getElementById('session-ops-subtitle').textContent = session.competition.name;
    document.getElementById('session-title-input').value = session.competition.name;
    document.getElementById('session-mode-badge').textContent = session.modeId.replace(/-/g, ' ').toUpperCase();
    document.getElementById('session-basketball-controls').classList.toggle('hidden', session.modeId !== 'basketball');
    const resetScoreButton = document.getElementById('btn-reset-score');
    resetScoreButton.textContent = session.modeId === 'volleyball' ? 'RESET SCORE + SETS' : 'RESET SCORE';
    renderSession(session);
    refreshMatchState().catch(error => reportSessionError(error));
    refreshScore().catch(error => reportSessionError(error));
  };

  const loadHealth = async () => {
    const obs = document.getElementById('slc-health-obs');
    const graphics = document.getElementById('slc-health-graphics');
    try {
      const status = await window.slcAPI.obs.getStatus();
      obs.textContent = status.connected ? 'CONNECTED' : status.connecting ? 'CONNECTING' : 'DISCONNECTED';
      obs.className = status.connected ? 'health-online' : 'health-offline';
    } catch (error) {
      obs.textContent = 'ERROR';
      obs.className = 'health-offline';
      document.getElementById('slc-health-message').textContent = error.message;
    }
    try {
      const info = await window.slcAPI.graphics.getRemoteControlInfo();
      graphics.textContent = info.port ? `ONLINE · ${info.port}` : 'OFFLINE';
      graphics.className = info.port ? 'health-online' : 'health-offline';
    } catch (error) {
      graphics.textContent = 'OFFLINE';
      graphics.className = 'health-offline';
      document.getElementById('slc-health-message').textContent = error.message;
    }
  };

  const beginSession = async session => {
    const readySession = session.status === 'SETUP'
      ? await window.slcAPI.session.activate()
      : session;
    setActiveSession(readySession);
  };

  const updateRecovery = state => {
    const resume = document.getElementById('slc-resume-session');
    const discard = document.getElementById('slc-discard-session');
    const summary = document.getElementById('slc-recovery-summary');
    recoverableSession = state.recoverable ? state.activeSession : null;
    resume.classList.toggle('hidden', !recoverableSession);
    discard.classList.toggle('hidden', !recoverableSession);
    summary.classList.toggle('hidden', !recoverableSession);
    summary.textContent = recoverableSession ? `UNFINISHED SESSION · ${formatSessionSummary(recoverableSession)}` : '';
  };

  const reportSessionError = error => {
    sessionFeedback.textContent = error.message || 'The requested operation failed.';
    sessionFeedback.classList.add('error');
  };

  const reportSessionSuccess = message => {
    sessionFeedback.textContent = message;
    sessionFeedback.classList.remove('error');
  };

  async function runSessionAction(action, successMessage = 'Saved.') {
    try {
      const updated = await action();
      if (updated && updated.id && updated.modeId) {
        currentSession = updated;
        renderSession(updated);
      }
      reportSessionSuccess(successMessage);
      return updated;
    } catch (error) {
      reportSessionError(error);
      return null;
    }
  }

  function appendText(parent, tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
  }

  function renderSession(session) {
    if (!session) return;
    currentSession = session;
    document.getElementById('session-ops-subtitle').textContent = session.competition.name;
    const titleInput = document.getElementById('session-title-input');
    if (document.activeElement !== titleInput) titleInput.value = session.competition.name;
    if (session.teams) {
      const score = session.snapshot?.score || null;
      for (const side of ['home', 'away']) {
        const team = session.teams[side];
        const displayedScore = score?.[side];
        document.getElementById(`session-${side}-name`).textContent = team.name;
        document.getElementById(`session-${side}-score`).textContent =
          String(displayedScore?.score ?? team.score ?? 0);
        const logo = document.getElementById(`session-${side}-logo`);
        const logoData = team.logo || displayedScore?.logo || '';
        logo.classList.toggle('hidden', !logoData);
        if (logoData) logo.src = logoData;
        renderScoreActions(side, session.modeId);
      }
    }
    renderSportStats(session);
    renderParticipants(session);
    if (session.modeId === 'athletics') renderAthletics(session);
  }

  function renderScoreActions(side, mode) {
    const container = document.getElementById(`session-${side}-score-actions`);
    container.replaceChildren();
    const increments = mode === 'basketball' ? [1, 2, 3]
      : mode === 'cricket' ? [1, 2, 3, 4, 6]
        : [1];
    increments.forEach(points => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-action-btn';
      button.textContent = `+${points}`;
      button.addEventListener('click', () => applyScore(side, points));
      container.appendChild(button);
      if (mode === 'basketball') {
        const subtract = document.createElement('button');
        subtract.type = 'button';
        subtract.className = 'secondary-action-btn';
        subtract.textContent = `−${points}`;
        subtract.addEventListener('click', () => applyScore(side, -points));
        container.appendChild(subtract);
      }
    });
    if (mode !== 'basketball') {
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'secondary-action-btn';
      minus.textContent = '−1';
      minus.addEventListener('click', () => applyScore(side, -1));
      container.appendChild(minus);
    }
  }

  async function applyScore(side, amount) {
    try {
      const outcome = await window.slcAPI.session.applyScoreChange(side, amount);
      currentSession = outcome.session;
      renderSession(outcome.session);
      for (const team of ['home', 'away']) {
        document.getElementById(`session-${team}-score`).textContent = String(outcome.score[team].score);
      }
      const completedPeriod = outcome.completed
        ? `${outcome.session.modeId === 'volleyball' ? 'Set' : 'Game'} ${outcome.completed.number}`
        : '';
      reportSessionSuccess(outcome.completed
        ? `${outcome.session.teams[outcome.completed.winner].name} wins ${completedPeriod}.`
        : 'Score updated.');
      if (outcome.completed) {
        const winner = outcome.session.teams[outcome.completed.winner].name;
        await window.slcAPI.graphics.showLowerThird({
          title: `${winner} WINS`,
          subtitle: `${completedPeriod} · ${outcome.completed.points.home}–${outcome.completed.points.away}`,
          duration: 8,
          position: 'bottom-center'
        });
      }
    } catch (error) {
      reportSessionError(error);
    }
  }

  async function refreshScore() {
    const [score, sessionState] = await Promise.all([
      window.slcAPI.score.get(),
      window.slcAPI.session.getState()
    ]);
    if (!currentSession || !sessionState.activeSession) return;
    currentSession = { ...sessionState.activeSession, snapshot: { ...sessionState.activeSession.snapshot, score } };
    for (const side of ['home', 'away']) {
      document.getElementById(`session-${side}-score`).textContent = String(score[side].score);
    }
  }

  async function refreshMatchState() {
    const match = await window.slcAPI.match.getState();
    renderClock(match.clock);
  }

  function renderClock(clock) {
    if (!clock) return;
    document.getElementById('session-clock-display').textContent = clock.formatted;
    const periodInput = document.getElementById('session-period-input');
    if (document.activeElement !== periodInput) periodInput.value = clock.period;
    document.getElementById('session-clock-toggle').textContent = clock.running ? 'PAUSE CLOCK' : 'START CLOCK';
    const startInput = document.getElementById('session-basketball-start-time');
    if (document.activeElement !== startInput) startInput.value = formatClockInput(clock.startSeconds);
    if (clock.offense) {
      renderOffenseClock(clock.offense);
    }
  }

  function renderOffenseClock(offense) {
    document.getElementById('session-offense-display').textContent = offense.display;
    document.getElementById('session-offense-toggle').textContent = offense.running ? 'PAUSE' : 'START';
    document.getElementById('session-offense-enabled').checked = offense.enabled === true;
    document.getElementById('session-offense-toggle').disabled = offense.enabled !== true;
    document.getElementById('session-offense-reset').disabled = offense.enabled !== true;
    const offenseInput = document.getElementById('session-offense-seconds');
    if (document.activeElement !== offenseInput) offenseInput.value = String(offense.limitSeconds);
  }

  function formatClockInput(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
  }

  function renderSportStats(session) {
    const stats = document.getElementById('session-sport-stats');
    stats.replaceChildren();
    const state = session.sportState || {};
    const addStat = (label, value, controls = []) => {
      const item = document.createElement('div');
      item.className = 'session-sport-stat';
      appendText(item, 'span', label);
      appendText(item, 'strong', String(value));
      controls.forEach(({ text, onClick }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary-action-btn';
        button.textContent = text;
        button.addEventListener('click', onClick);
        item.appendChild(button);
      });
      stats.appendChild(item);
    };
    if (session.modeId === 'cricket') {
      addStat('INNINGS', state.periodNumber || 1, [{
        text: 'NEXT',
        onClick: () => updateSportState({ periodNumber: Math.min(2, (state.periodNumber || 1) + 1), period: `${(state.periodNumber || 1) + 1}${(state.periodNumber || 1) === 1 ? 'nd' : 'rd'} Innings` })
      }]);
      for (const side of ['home', 'away']) {
        addStat(`${session.teams[side].name} WICKETS`, state.wickets?.[side] || 0, [
          { text: '+W', onClick: () => updateSportState({ wickets: { [side]: (state.wickets?.[side] || 0) + 1 } }) },
          { text: '−', onClick: () => updateSportState({ wickets: { [side]: Math.max(0, (state.wickets?.[side] || 0) - 1) } }) }
        ]);
        addStat(`${session.teams[side].name} OVERS`, state.overs?.[side] || 0, [
          { text: '+OVER', onClick: () => updateSportState({ overs: { [side]: (state.overs?.[side] || 0) + 1 } }) }
        ]);
      }
    } else if (['volleyball', 'table-tennis', 'badminton'].includes(session.modeId)) {
      for (const side of ['home', 'away']) {
        addStat(`${session.teams[side].name} SETS`, state.sets?.[side] || 0, [
          { text: '+', onClick: () => updateSportState({ sets: { [side]: (state.sets?.[side] || 0) + 1 } }) },
          { text: '−', onClick: () => updateSportState({ sets: { [side]: Math.max(0, (state.sets?.[side] || 0) - 1) } }) }
        ]);
      }
      if (session.modeId !== 'volleyball') {
        addStat('POINTS TO WIN', state.pointsToWin || 21);
      }
    } else     if (session.modeId === 'basketball') {
      stats.classList.add('hidden');
      return;
    }
    const volleyballRules = document.getElementById('session-volleyball-rules');
    const tableTennisRules = document.getElementById('session-table-tennis-rules');
    volleyballRules.classList.toggle('hidden', session.modeId !== 'volleyball');
    tableTennisRules.classList.toggle('hidden', session.modeId !== 'table-tennis');
    if (!volleyballRules.contains(document.activeElement)) {
      document.getElementById('volleyball-points-to-win').value = String(state.pointsToWin || 25);
      document.getElementById('volleyball-deciding-points-to-win').value =
        String(state.decidingSetPointsToWin || 15);
      document.getElementById('volleyball-points-to-win-by').value = String(state.pointsToWinBy || 2);
    }
    if (!tableTennisRules.contains(document.activeElement)) {
      document.getElementById('table-tennis-points-to-win').value = String(state.pointsToWin || 11);
    }
    stats.classList.toggle('hidden', stats.childElementCount === 0);
  }

  async function updateSportState(patch) {
    const result = await runSessionAction(
      () => window.slcAPI.session.updateSportState(patch),
      'Sport state updated.'
    );
    if (result) renderSportStats(result);
  }

  function renderParticipants(session) {
    const list = document.getElementById('session-participant-list');
    list.replaceChildren();
    (session.participants || []).forEach(participant => {
      const row = document.createElement('div');
      row.className = 'session-record-row';
      const detail = document.createElement('div');
      appendText(detail, 'span', `${participant.name}${participant.number === null ? '' : ` · #${participant.number}`}`);
      appendText(detail, 'small', [participant.type.toUpperCase(), participant.team, participant.role].filter(Boolean).join(' · '));
      row.appendChild(detail);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'REMOVE';
      remove.addEventListener('click', () => runSessionAction(
        () => window.slcAPI.session.removeParticipant(participant.id),
        'Participant removed.'
      ));
      row.appendChild(remove);
      list.appendChild(row);
    });
    if (!list.childElementCount) appendText(list, 'div', 'No participants added yet.', 'session-record-row');
  }

  function renderAthletics(session) {
    const houses = session.athletics?.houses || [];
    const liveEvent = session.athletics?.currentEvent || null;
    const eventNameInput = document.getElementById('athletics-event-name');
    const eventCategoryInput = document.getElementById('athletics-event-category');
    if (document.activeElement !== eventNameInput) eventNameInput.value = liveEvent?.name || '';
    if (document.activeElement !== eventCategoryInput) {
      const category = liveEvent?.category || 'running';
      eventCategoryInput.value = category === 'track' ? 'running' : category === 'field' ? 'shot-put' : category;
    }
    const podiumButton = document.getElementById('athletics-podium-toggle');
    podiumButton.textContent = session.athletics?.podiumVisible ? 'HIDE PODIUM' : 'SHOW PODIUM';
    podiumButton.disabled = !liveEvent?.results?.length;
    const houseList = document.getElementById('athletics-house-list');
    const houseSelect = document.getElementById('athletics-result-team');
    const shotPutHouseSelect = document.getElementById('athletics-shotput-team');
    const previousHouse = houseSelect.value;
    const previousShotPutHouse = shotPutHouseSelect.value;
    houseList.replaceChildren();
    houseSelect.replaceChildren();
    shotPutHouseSelect.replaceChildren();

    houses.forEach(house => {
      for (const select of [houseSelect, shotPutHouseSelect]) {
        const option = document.createElement('option');
        option.value = house.name;
        option.textContent = house.name;
        select.appendChild(option);
      }

      const row = document.createElement('div');
      row.className = 'athletics-house-row';
      if (house.logo) {
        const logo = document.createElement('img');
        logo.src = house.logo;
        logo.alt = '';
        row.appendChild(logo);
      } else {
        const badge = appendText(row, 'span', house.name.slice(0, 1).toUpperCase(), 'athletics-house-badge');
        badge.style.backgroundColor = house.color || '#64748b';
      }
      appendText(row, 'span', house.name);
      const uploadLabel = appendText(row, 'label', house.logo ? 'CHANGE LOGO' : 'ADD LOGO', 'session-logo-upload');
      const upload = document.createElement('input');
      upload.type = 'file';
      upload.accept = '.svg,image/svg+xml,image/png,image/jpeg';
      upload.addEventListener('change', async event => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 750 * 1024) {
          reportSessionError(new Error('House logo must be smaller than 750 KB.'));
          input.value = '';
          return;
        }
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('House logo file could not be read.'));
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
          });
          const updated = await window.slcAPI.session.setAthleticsHouseLogo(house.id, dataUrl);
          currentSession = updated;
          renderAthletics(updated);
          reportSessionSuccess(`${house.name} logo saved.`);
        } catch (error) {
          reportSessionError(error);
        } finally {
          input.value = '';
        }
      });
      uploadLabel.appendChild(upload);
      houseList.appendChild(row);
    });
    if (houses.some(house => house.name === previousHouse)) houseSelect.value = previousHouse;
    if (houses.some(house => house.name === previousShotPutHouse)) shotPutHouseSelect.value = previousShotPutHouse;

    houseSelect.disabled = houses.length === 0;
    shotPutHouseSelect.disabled = houses.length === 0;
    document.getElementById('athletics-active-event').textContent =
      liveEvent ? `LIVE STANDINGS · ${liveEvent.name}` : 'SET A LIVE EVENT TITLE TO RECORD RESULTS';
    document.getElementById('athletics-record-result').disabled = !liveEvent;
    const isShotPut = liveEvent?.category === 'shot-put';
    document.getElementById('athletics-result-form').classList.toggle('hidden', isShotPut);
    document.getElementById('athletics-shotput-form').classList.toggle('hidden', !isShotPut);
    document.getElementById('athletics-shotput-table-wrap').classList.toggle('hidden', !isShotPut);
    document.getElementById('athletics-record-result').classList.toggle('hidden', isShotPut);
    renderShotPutAttempts(liveEvent);
    renderAthleticsEventStandings(liveEvent, houses);
    updateRelayResultFields(liveEvent);

    window.slcAPI.session.getAthleticsStandings().then(standings => {
      const list = document.getElementById('athletics-standings');
      list.replaceChildren();
      standings.forEach((standing, index) => {
        const house = houses.find(item => item.name === standing.team);
        const row = document.createElement('div');
        row.className = 'athletics-championship-row';
        appendAthleticsHouseMark(row, house);
        appendText(row, 'strong', `${index + 1}. ${standing.team}`);
        appendText(row, 'span', `${standing.points} pts`);
        appendText(row, 'small', `🥇 ${standing.medals.gold}  🥈 ${standing.medals.silver}  🥉 ${standing.medals.bronze}`);
        list.appendChild(row);
      });
      if (!standings.length) appendText(list, 'div', 'House totals appear after results are entered.', 'session-record-row');
    }).catch(reportSessionError);
  }

  function updateRelayResultFields(event) {
    const isRelay = event?.category === 'relay';
    document.getElementById('athletics-athlete-label').classList.toggle('hidden', isRelay);
    document.getElementById('athletics-runners-label').classList.toggle('hidden', !isRelay);
    document.getElementById('athletics-result-athlete').required = !isRelay;
    document.getElementById('athletics-result-runners').required = isRelay;
  }

  function renderShotPutAttempts(event) {
    const body = document.getElementById('athletics-shotput-table-body');
    body.replaceChildren();
    (event?.category === 'shot-put' ? event.results : []).forEach(result => {
      const row = document.createElement('tr');
      const athlete = document.createElement('th');
      athlete.scope = 'row';
      athlete.textContent = `${result.athleteName} · ${result.team}`;
      row.appendChild(athlete);
      for (let index = 0; index < 6; index++) {
        const cell = document.createElement('td');
        const distance = result.attempts?.[index];
        cell.textContent = Number.isFinite(distance) ? `${distance.toFixed(2)} m` : '—';
        row.appendChild(cell);
      }
      const final = document.createElement('td');
      final.textContent = result.bestDistance
        ? `${result.bestDistance.toFixed(2)} m · #${result.place}`
        : '—';
      row.appendChild(final);
      body.appendChild(row);
    });
    if (event?.category === 'shot-put' && !body.childElementCount) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.textContent = 'Attempt distances will appear here as they are recorded.';
      row.appendChild(cell);
      body.appendChild(row);
    }
  }

  function appendAthleticsHouseMark(parent, house) {
    if (house?.logo) {
      const logo = document.createElement('img');
      logo.src = house.logo;
      logo.alt = `${house.name} logo`;
      logo.className = 'athletics-result-logo';
      parent.appendChild(logo);
    } else {
      const badge = appendText(parent, 'span', house?.name?.slice(0, 1).toUpperCase() || '?', 'athletics-result-logo athletics-house-badge');
      badge.style.backgroundColor = house?.color || '#64748b';
    }
  }

  function renderAthleticsEventStandings(event, houses) {
    const list = document.getElementById('athletics-event-standings');
    list.replaceChildren();
    if (!event) {
      appendText(list, 'div', 'Set the live event title above. Results will appear here as they are entered.', 'session-record-row');
      return;
    }
    appendText(list, 'h4', event.name);
    event.results.forEach(result => {
      const row = document.createElement('div');
      row.className = 'athletics-result-row';
      appendText(row, 'span', String(result.place), 'athletics-result-place');
      appendAthleticsHouseMark(row, houses.find(house => house.name === result.team));
      const athlete = document.createElement('div');
      athlete.className = 'athletics-result-athlete';
      appendText(athlete, 'strong', (result.runnerNames || []).join(' → ') || result.athleteName);
      appendText(athlete, 'small', result.team);
      row.appendChild(athlete);
      appendText(row, 'strong', result.result, 'athletics-result-measure');
      const remove = appendText(row, 'button', 'REMOVE', 'athletics-result-remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${result.athleteName} from live standings`);
      remove.addEventListener('click', async () => {
        const updated = await runSessionAction(
          () => window.slcAPI.session.removeAthleticsResult(result.id),
          'Live result removed.'
        );
        if (updated) renderAthletics(updated);
      });
      list.appendChild(row);
    });
    if (!event.results.length) appendText(list, 'div', 'No results entered yet. Add each placing as it happens.', 'session-record-row');
  }

  modes.forEach(([id, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slc-mode-card';
    button.textContent = label;
    button.addEventListener('click', () => {
      selectedMode = id;
      document.getElementById('slc-setup-title').textContent = `${label.toUpperCase()} SESSION SETUP`;
      const needsTeams = !['formal-event', 'athletics'].includes(id);
      teamSetup.classList.toggle('hidden', !needsTeams);
      tableTennisSetup.classList.toggle('hidden', id !== 'table-tennis');
      updateTableTennisSetup();
      document.getElementById('slc-team-catalog-hint').classList.toggle('hidden', id !== 'athletics');
      document.getElementById('slc-home-team-label').firstChild.textContent = id === 'athletics' ? 'HOUSE' : 'HOME TEAM';
      document.getElementById('slc-away-team-label').firstChild.textContent = id === 'athletics' ? 'HOUSE' : 'AWAY TEAM';
      document.getElementById('slc-team-catalog-hint').textContent = id === 'athletics'
        ? `Configured houses and logos: ${teamCatalog.map(team => team.name).join(', ')}.`
        : '';
      document.getElementById('slc-home-team').required = needsTeams;
      document.getElementById('slc-away-team').required = needsTeams;
      formError.textContent = '';
      showStep('setup');
      document.getElementById('slc-competition-name').focus();
    });
    document.getElementById('slc-mode-grid').appendChild(button);
  });

  document.getElementById('slc-new-session').addEventListener('click', async () => {
    if (recoverableSession) {
      const confirmed = window.confirm('Starting a new session will replace the unfinished session recovery record. Continue?');
      if (!confirmed) return;
      try {
        updateRecovery(await window.slcAPI.session.discard());
      } catch (error) {
        document.getElementById('slc-health-message').textContent = error.message;
        return;
      }
    }
    showStep('modes');
  });
  document.getElementById('slc-back-home').addEventListener('click', () => showStep('home'));
  document.getElementById('slc-back-modes').addEventListener('click', () => showStep('modes'));

  document.getElementById('slc-session-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.getElementById('slc-create-session');
    button.disabled = true;
    formError.textContent = '';
    try {
      const session = await window.slcAPI.session.create({
        mode: selectedMode,
        competitionName: document.getElementById('slc-competition-name').value,
        shortName: document.getElementById('slc-short-name').value,
        season: document.getElementById('slc-season').value,
        division: document.getElementById('slc-division').value,
        venue: document.getElementById('slc-venue').value,
        date: document.getElementById('slc-date').value,
        homeTeamId: document.getElementById('slc-home-team').value,
        awayTeamId: document.getElementById('slc-away-team').value,
        tableTennisFormat: tableTennisFormat.value,
        tableTennisPlayers: {
          home: [
            document.getElementById('slc-table-tennis-home-player-1').value,
            document.getElementById('slc-table-tennis-home-player-2').value
          ].slice(0, tableTennisFormat.value === 'doubles' ? 2 : 1),
          away: [
            document.getElementById('slc-table-tennis-away-player-1').value,
            document.getElementById('slc-table-tennis-away-player-2').value
          ].slice(0, tableTennisFormat.value === 'doubles' ? 2 : 1)
        }
      });
      await beginSession(session);
    } catch (error) {
      formError.textContent = error.message || 'Session setup failed.';
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('slc-resume-session').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const session = await window.slcAPI.session.resume();
      setActiveSession(session);
    } catch (error) {
      document.getElementById('slc-health-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('slc-discard-session').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      updateRecovery(await window.slcAPI.session.discard());
    } catch (error) {
      document.getElementById('slc-health-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('btn-end-session').addEventListener('click', async () => {
    if (!document.getElementById('active-sequence-bar').classList.contains('hidden')) {
      window.alert('Finish or cancel the active broadcast sequence before ending this session.');
      return;
    }
    if (!window.confirm('End this broadcast session? The saved match state will remain available for recovery.')) return;
    try {
      await window.slcAPI.match.clockPause();
      await window.slcAPI.match.pauseOffenseClock();
      await window.slcAPI.session.end();
      document.body.removeAttribute('data-active-mode');
      document.getElementById('btn-end-session').classList.add('hidden');
      document.getElementById('session-context-banner').classList.add('hidden');
      sessionOpsPanel.classList.add('hidden');
      document.querySelector('.col-match').classList.remove('hidden');
      document.querySelector('.col-replay').classList.remove('hidden');
      launchScreen.classList.remove('hidden');
      showStep('home');
      updateRecovery(await window.slcAPI.session.getState());
    } catch (error) {
      window.alert(error.message || 'The session could not be ended.');
    }
  });

  document.getElementById('session-participant-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await runSessionAction(() => window.slcAPI.session.addParticipant({
      name: document.getElementById('session-participant-name').value,
      type: document.getElementById('session-participant-type').value,
      number: document.getElementById('session-participant-number').value,
      team: document.getElementById('session-participant-team').value
    }), 'Participant added.');
    if (result) form.reset();
  });

  for (const side of ['home', 'away']) {
    document.getElementById(`session-${side}-logo-file`).addEventListener('change', async event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 750 * 1024) {
        reportSessionError(new Error('Team logo must be smaller than 750 KB.'));
        input.value = '';
        return;
      }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Team logo file could not be read.'));
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        const updated = await window.slcAPI.session.setTeamLogo(side, dataUrl);
        currentSession = updated;
        renderSession(updated);
        await refreshScore();
        reportSessionSuccess(`${side === 'home' ? 'Home' : 'Away'} team logo saved.`);
      } catch (error) {
        reportSessionError(error);
      } finally {
        input.value = '';
      }
    });
  }

  document.getElementById('session-clock-toggle').addEventListener('click', async () => {
    const state = await runSessionAction(() => window.slcAPI.match.clockToggle(), 'Clock updated.');
    if (state) renderClock(state);
  });
  document.getElementById('session-clock-reset').addEventListener('click', async () => {
    const state = await runSessionAction(() => window.slcAPI.match.clockReset(), 'Clock reset.');
    if (state) renderClock(state);
  });
  document.getElementById('session-scorebug-toggle').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      scorebugExpanded = await window.slcAPI.graphics.setScorebugExpanded(!scorebugExpanded);
      const label = currentSession?.modeId === 'athletics' ? 'STANDINGS' : 'SCOREBUG';
      button.textContent = `${scorebugExpanded ? 'COLLAPSE' : 'EXPAND'} ${label}`;
    } catch (error) {
      reportSessionError(error);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('session-period-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.getElementById('session-period-input');
    const period = input.value.trim();
    if (!period) {
      reportSessionError(new Error('Period label cannot be empty.'));
      return;
    }
    const updated = await runSessionAction(
      () => Promise.all([
        currentSession?.modeId === 'basketball'
          ? window.slcAPI.session.updateSportState({ period })
          : Promise.resolve(currentSession),
        window.slcAPI.match.setPeriod(period)
      ]).then(([session]) => session),
      'Period label updated.'
    );
    if (updated) input.value = period;
  });

  document.getElementById('session-volleyball-rules').addEventListener('submit', async event => {
    event.preventDefault();
    const pointsToWin = Number(document.getElementById('volleyball-points-to-win').value);
    const decidingSetPointsToWin = Number(
      document.getElementById('volleyball-deciding-points-to-win').value
    );
    const pointsToWinBy = Number(document.getElementById('volleyball-points-to-win-by').value);
    if (![pointsToWin, decidingSetPointsToWin, pointsToWinBy].every(Number.isInteger) ||
        pointsToWin < 1 || pointsToWin > 999 ||
        decidingSetPointsToWin < 1 || decidingSetPointsToWin > 999 ||
        pointsToWinBy < 1 || pointsToWinBy > 10) {
      reportSessionError(new Error('Set points must be 1–999 and the win margin must be 1–10.'));
      return;
    }
    await runSessionAction(
      () => window.slcAPI.session.updateSportState({
        pointsToWin,
        decidingSetPointsToWin,
        pointsToWinBy
      }),
      'Volleyball set rules updated.'
    );
  });

  document.getElementById('session-table-tennis-rules').addEventListener('submit', async event => {
    event.preventDefault();
    const pointsToWin = Number(document.getElementById('table-tennis-points-to-win').value);
    if (!Number.isInteger(pointsToWin) || pointsToWin < 1 || pointsToWin > 999) {
      reportSessionError(new Error('Game points must be a whole number from 1 to 999.'));
      return;
    }
    await runSessionAction(
      () => window.slcAPI.session.updateSportState({ pointsToWin }),
      'Table tennis game rules updated.'
    );
  });

  document.getElementById('session-basketball-start-form').addEventListener('submit', async event => {
    event.preventDefault();
    const value = document.getElementById('session-basketball-start-time').value.trim();
    const match = /^(\d{1,3}):([0-5]\d)$/.exec(value);
    if (!match) {
      reportSessionError(new Error('Game start time must use MM:SS with seconds from 00 to 59.'));
      return;
    }
    const seconds = Number(match[1]) * 60 + Number(match[2]);
    const clock = await window.slcAPI.match.getState();
    if (seconds > clock.clock.regulationSeconds) {
      reportSessionError(new Error('Game start time cannot exceed the configured quarter length.'));
      return;
    }
    const updated = await runSessionAction(
      () => window.slcAPI.match.setStartTime(seconds),
      'Basketball game start time updated.'
    );
    if (updated) refreshMatchState().catch(reportSessionError);
  });

  document.getElementById('session-offense-form').addEventListener('submit', async event => {
    event.preventDefault();
    const seconds = Number(document.getElementById('session-offense-seconds').value);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
      reportSessionError(new Error('Offense timer must be a whole number from 1 to 120 seconds.'));
      return;
    }
    try {
      const state = await window.slcAPI.match.setOffenseClock({ seconds, limitSeconds: seconds });
      document.getElementById('session-offense-display').textContent = state.display;
      reportSessionSuccess('Offense timer configured.');
    } catch (error) {
      reportSessionError(error);
    }
  });

  document.getElementById('session-offense-toggle').addEventListener('click', async () => {
    try {
      const state = await window.slcAPI.match.toggleOffenseClock();
      document.getElementById('session-offense-display').textContent = state.display;
      document.getElementById('session-offense-toggle').textContent = state.running ? 'PAUSE' : 'START';
    } catch (error) {
      reportSessionError(error);
    }
  });
  document.getElementById('session-offense-enabled').addEventListener('change', async event => {
    const enabled = event.currentTarget.checked;
    try {
      const state = await window.slcAPI.match.setOffenseClockEnabled(enabled);
      renderOffenseClock(state);
    } catch (error) {
      event.currentTarget.checked = !enabled;
      reportSessionError(error);
    }
  });

  document.getElementById('session-offense-reset').addEventListener('click', async () => {
    try {
      const state = await window.slcAPI.match.resetOffenseClock();
      document.getElementById('session-offense-display').textContent = state.display;
      document.getElementById('session-offense-toggle').textContent = 'START';
    } catch (error) {
      reportSessionError(error);
    }
  });

  document.getElementById('athletics-house-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = document.getElementById('athletics-house-name').value;
    const result = await runSessionAction(
      () => window.slcAPI.session.addAthleticsHouse(name),
      'House added.'
    );
    if (result) {
      form.reset();
      renderAthletics(result);
    }
  });

  document.getElementById('session-title-form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = document.getElementById('session-title-input').value.trim();
    await runSessionAction(
      () => window.slcAPI.session.updateCompetitionName(name),
      'On-screen competition or event name updated.'
    );
  });

  document.getElementById('athletics-event-form').addEventListener('submit', async event => {
    event.preventDefault();
    const result = await runSessionAction(() => window.slcAPI.session.setAthleticsEvent({
      name: document.getElementById('athletics-event-name').value,
      category: document.getElementById('athletics-event-category').value
    }), 'Live event updated. Existing standings remain live.');
    if (result) renderAthletics(result);
  });

  document.getElementById('athletics-podium-toggle').addEventListener('click', async event => {
    const visible = event.currentTarget.textContent.trim() !== 'HIDE PODIUM';
    const updated = await runSessionAction(
      () => window.slcAPI.session.setAthleticsPodiumVisible(visible),
      visible ? 'Podium is on air.' : 'Live standings are back on air.'
    );
    if (updated) renderAthletics(updated);
  });

  document.getElementById('athletics-result-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await runSessionAction(() => window.slcAPI.session.recordAthleticsResult({
      athleteName: document.getElementById('athletics-result-athlete').value ||
        document.getElementById('athletics-result-runners').value.split(',').map(name => name.trim()).filter(Boolean).join(' → '),
      runnerNames: document.getElementById('athletics-result-runners').value.split(',').map(name => name.trim()).filter(Boolean),
      team: document.getElementById('athletics-result-team').value,
      result: document.getElementById('athletics-result-value').value,
      place: Number(document.getElementById('athletics-result-place').value)
    }), 'Live standings updated.');
    if (result) {
      form.reset();
      document.getElementById('athletics-result-place').value = '1';
      renderAthletics(result);
    }
  });

  document.getElementById('athletics-shotput-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await runSessionAction(() => window.slcAPI.session.recordAthleticsResult({
      athleteName: document.getElementById('athletics-shotput-athlete').value,
      team: document.getElementById('athletics-shotput-team').value,
      attempt: Number(document.getElementById('athletics-shotput-attempt').value),
      distance: Number(document.getElementById('athletics-shotput-distance').value)
    }), 'Shot Put attempt saved and standings recalculated.');
    if (result) {
      document.getElementById('athletics-shotput-distance').value = '';
      const athleteName = document.getElementById('athletics-shotput-athlete').value.trim().toLocaleLowerCase();
      const team = document.getElementById('athletics-shotput-team').value;
      const entry = result.athletics.currentEvent.results.find(item =>
        item.athleteName.toLocaleLowerCase() === athleteName && item.team === team
      );
      const nextAttempt = entry?.attempts.findIndex(distance => !Number.isFinite(distance)) ?? -1;
      document.getElementById('athletics-shotput-attempt').value = String(nextAttempt >= 0 ? nextAttempt + 1 : 6);
      renderAthletics(result);
    }
  });

  document.getElementById('formal-cue-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const title = document.getElementById('formal-cue-title').value.trim();
      const subtitle = document.getElementById('formal-cue-subtitle').value.trim();
      await window.slcAPI.graphics.showLowerThird({
        title,
        subtitle,
        duration: 0,
        position: 'bottom-center'
      });
      await window.slcAPI.events.record('FORMAL_EVENT_CUE', { title, subtitle });
      reportSessionSuccess('Cue is on air. Hide it using the Graphics controls.');
    } catch (error) {
      reportSessionError(error);
    }
  });

  document.getElementById('session-replay-capture').addEventListener('click', async () => {
    const result = await window.slcAPI.replay.captureAll();
    if (result.ok) reportSessionSuccess('Replay buffer save triggered in OBS.');
    else reportSessionError(new Error(result.error || 'Replay capture failed.'));
  });
  document.getElementById('session-replay-select').addEventListener('click', async () => {
    try {
      const name = await window.slcAPI.replay.chooseFile();
      if (name) {
        selectedReplayName = name;
        document.getElementById('session-replay-selected').textContent = name;
        document.getElementById('session-replay-air').disabled = false;
        reportSessionSuccess('Replay selected.');
      }
    } catch (error) {
      reportSessionError(error);
    }
  });
  document.getElementById('session-replay-air').addEventListener('click', async () => {
    try {
      await window.slcAPI.replay.air();
      document.getElementById('session-replay-stop').disabled = false;
      reportSessionSuccess(`${selectedReplayName} is on air.`);
    } catch (error) {
      reportSessionError(error);
    }
  });
  document.getElementById('session-replay-stop').addEventListener('click', async () => {
    try {
      await window.slcAPI.replay.stop();
      document.getElementById('session-replay-stop').disabled = true;
      reportSessionSuccess('Replay stopped. Returned to LIVE.');
    } catch (error) {
      reportSessionError(error);
    }
  });

  window.slcAPI.score.onChanged(refreshScore);
  window.slcAPI.match.onClockTick(renderClock);
  window.slcAPI.match.onClockChanged(renderClock);
  window.slcAPI.match.onOffenseTick(renderOffenseClock);

  try {
    updateRecovery(await window.slcAPI.session.getState());
  } catch (error) {
    document.getElementById('slc-health-message').textContent = error.message;
  }
  await loadHealth();
  window.slcAPI.obs.onStatusChanged(loadHealth);
  window.slcAPI.session.onStorageError(message => {
    document.getElementById('slc-health-message').textContent = `SESSION SAVE ERROR: ${message}`;
  });
});
