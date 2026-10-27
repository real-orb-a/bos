// Match Controls & Event Logging Module
window.MatchModule = (function() {
  const btnGarnetGoal = document.getElementById('btn-garnet-goal');
  const btnTopazGoal = document.getElementById('btn-topaz-goal');
  const scoringValueButtons = document.querySelectorAll('.scoring-value-btn');
  const btnAddHome = document.getElementById('btn-add-home');
  const btnSubHome = document.getElementById('btn-sub-home');
  const btnAddAway = document.getElementById('btn-add-away');
  const btnSubAway = document.getElementById('btn-sub-away');
  const btnResetScore = document.getElementById('btn-reset-score');
  const btnToggleScorebug = document.getElementById('btn-toggle-scorebug');
  const btnToggleScreenCenterScorebug = document.getElementById('btn-toggle-screen-center-scorebug');
  const displayHomeScore = document.getElementById('display-home-score');
  const displayAwayScore = document.getElementById('display-away-score');
  const cardHomeName = document.getElementById('card-home-name');
  const cardAwayName = document.getElementById('card-away-name');
  const homeGoalHotkey = document.getElementById('home-goal-hotkey');
  const awayGoalHotkey = document.getElementById('away-goal-hotkey');
  let selectedScoreValue = 1;
  window.goalActionLabels = { home: 'GOAL', away: 'GOAL' };

  const selectMatchState = document.getElementById('select-match-state');
  const selectPeriod = document.getElementById('select-period');
  const inputStartTime = document.getElementById('input-start-time');
  const stoppageButtons = document.querySelectorAll('.stoppage-btn');

  const btnClockToggle = document.getElementById('btn-clock-toggle');
  const btnClockReset = document.getElementById('btn-clock-reset');
  const masterClockDisplay = document.getElementById('master-clock-display');
  const masterPeriodDisplay = document.getElementById('master-period-display');
  const masterStoppageDisplay = document.getElementById('master-stoppage-display');
  const offenseClockHeader = document.getElementById('offense-clock-header');
  const headerOffenseDisplay = document.getElementById('header-offense-display');
  const btnHeaderOffenseToggle = document.getElementById('btn-header-offense-toggle');
  const btnHeaderOffenseReset = document.getElementById('btn-header-offense-reset');
  const selectTimerMode = document.getElementById('select-timer-mode');
  const selectAdditionalTimeMode = document.getElementById('select-additional-time-mode');
  const btnApproveAddedTime = document.getElementById('btn-approve-added-time');
  const inputRegulationMin = document.getElementById('input-regulation-min');
  const regulationTimeControl = document.getElementById('regulation-time-control');
  const startTimeControl = document.getElementById('start-time-control');
  const additionalTimeModeControl = document.getElementById('additional-time-mode-control');
  const stoppageTimeControl = document.getElementById('stoppage-time-control');
  const offenseTimerControl = document.getElementById('offense-timer-control');
  const inputOffenseSeconds = document.getElementById('input-offense-seconds');
  const offenseTimerDisplay = document.getElementById('offense-timer-display');
  const btnOffenseToggle = document.getElementById('btn-offense-toggle');
  const btnOffenseReset = document.getElementById('btn-offense-reset');
  const volleyballSetsControl = document.getElementById('volleyball-sets-control');
  const inputBestOfSets = document.getElementById('input-best-of-sets');
  const homeSetsWon = document.getElementById('home-sets-won');
  const awaySetsWon = document.getElementById('away-sets-won');
  const setTallyAdjustButtons = document.querySelectorAll('.set-tally-adjust');
  const completedSetsList = document.getElementById('completed-sets-list');
  const btnAwardSetHome = document.getElementById('btn-award-set-home');
  const btnAwardSetAway = document.getElementById('btn-award-set-away');
  const btnResetSets = document.getElementById('btn-reset-sets');
  const remoteControlLink = document.getElementById('remote-control-link');
  const remoteControlPassword = document.getElementById('remote-control-password');
  const remoteControlAddresses = document.getElementById('remote-control-addresses');
  const remoteControlPasswordStatus = document.getElementById('remote-control-password-status');
  const btnSaveRemotePassword = document.getElementById('btn-save-remote-password');
  const btnToggleRemotePassword = document.getElementById('btn-toggle-remote-password');
  const remoteImmediateScore = document.getElementById('remote-immediate-score');
  const remoteScoreRequestCount = document.getElementById('remote-score-request-count');
  const remoteScoreRequestList = document.getElementById('remote-score-request-list');

  const eventFeedList = document.getElementById('event-feed-list');
  const btnClearEvents = document.getElementById('btn-clear-events');

  function init() {
    bindEvents();
    loadInitialState();
    loadScorebugVisibility();
    listenIpc();
    loadRemoteControlInfo();
    loadRemoteScoreProposals();
  }

  function bindEvents() {
    // Dedicated Goal Triggers (Section 9)
    btnGarnetGoal.addEventListener('click', () => {
      triggerGoalSequence('home');
    });

    btnTopazGoal.addEventListener('click', () => {
      triggerGoalSequence('away');
    });

    scoringValueButtons.forEach(button => {
      button.addEventListener('click', () => {
        selectedScoreValue = Number(button.dataset.scorePoints) || 1;
        scoringValueButtons.forEach(option => {
          const selected = option === button;
          option.classList.toggle('active', selected);
          option.setAttribute('aria-pressed', String(selected));
        });
      });
    });

    // Score adjustments
    btnAddHome.addEventListener('click', () => window.bosAPI.score.addHome(selectedScoreValue));
    btnSubHome.addEventListener('click', () => window.bosAPI.score.subtractHome(selectedScoreValue));
    btnAddAway.addEventListener('click', () => window.bosAPI.score.addAway(selectedScoreValue));
    btnSubAway.addEventListener('click', () => window.bosAPI.score.subtractAway(selectedScoreValue));
    btnResetScore.addEventListener('click', () => {
      const isBasketballMode = selectTimerMode.value === 'countdown';
      const message = isBasketballMode
        ? 'Reset match score?'
        : 'Reset match score and all completed sets?';
      if (confirm(message)) {
        window.bosAPI.score.reset();
      }
    });

    btnToggleScorebug.addEventListener('click', async () => {
      // Lock normal score bug while center score bug is visible.
      const centerVisible =
        btnToggleScreenCenterScorebug.getAttribute('aria-pressed') === 'true';
      if (centerVisible) return;
      const currentlyVisible = btnToggleScorebug.getAttribute('aria-pressed') === 'true';
      const visible = await window.bosAPI.graphics.setScorebugVisible(!currentlyVisible);
      updateScorebugButton(visible);
    });

    btnToggleScreenCenterScorebug.addEventListener('click', async () => {
      const currentlyVisible =
        btnToggleScreenCenterScorebug.getAttribute('aria-pressed') === 'true';
      const visible = await window.bosAPI.graphics.setScreenCenterScorebugVisible(
        !currentlyVisible
      );
      updateScreenCenterScorebugButton(visible);
    });

    // Match State
    selectMatchState.addEventListener('change', (e) => {
      window.bosAPI.match.setState(e.target.value);
    });

    // Period
    selectPeriod.addEventListener('change', (e) => {
      const periodLabel = e.target.value.trim() || '1st Half';
      e.target.value = periodLabel;
      window.bosAPI.match.setPeriod(periodLabel);
    });

    // Stoppage / additional time buttons (allotted +N shown & counted after the set time)
    stoppageButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        stoppageButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const min = parseInt(btn.dataset.min, 10);
        window.bosAPI.match.setClock({ stoppageMinutes: min });
      });
    });

    // Timer mode: stopwatch (count up to the set time) or countdown (count down to 00:00)
    selectTimerMode.addEventListener('change', (e) => {
      updateSportControls(e.target.value);
      window.bosAPI.match.setTimerMode(e.target.value);
    });

    selectAdditionalTimeMode.addEventListener('change', (e) => {
      window.bosAPI.match.setAdditionalTimeMode(e.target.value);
    });

    btnApproveAddedTime.addEventListener('click', () => {
      window.bosAPI.match.approveAdditionalTime();
    });

    // Set time (regulation length in minutes)
    inputRegulationMin.addEventListener('change', () => {
      const mins = Math.max(1, parseInt(inputRegulationMin.value, 10) || 90);
      inputRegulationMin.value = mins;
      window.bosAPI.match.setClock({ regulationMinutes: mins });
    });

    inputBestOfSets.addEventListener('change', async () => {
      try {
        const sets = await window.bosAPI.match.setBestOfSets(inputBestOfSets.value);
        updateSetUI(sets);
      } catch (err) {
        window.alert(err.message);
        const state = await window.bosAPI.match.getState();
        updateSetUI(state.sets);
      }
    });

    btnAwardSetHome.addEventListener('click', () => completeSet('home'));
    btnAwardSetAway.addEventListener('click', () => completeSet('away'));
    setTallyAdjustButtons.forEach(button => {
      button.addEventListener('click', async () => {
        try {
          const sets = await window.bosAPI.match.adjustSetTally(
            button.dataset.team,
            Number(button.dataset.amount)
          );
          updateSetUI(sets);
        } catch (err) {
          window.alert(err.message);
        }
      });
    });
    btnResetSets.addEventListener('click', async () => {
      if (!confirm('Reset all completed volleyball sets?')) return;
      updateSetUI(await window.bosAPI.match.resetSets());
    });

    btnSaveRemotePassword.addEventListener('click', async () => {
      const password = remoteControlPassword.value;
      if (password.trim().length < 8) {
        window.alert('Remote password must be at least 8 characters.');
        return;
      }

      btnSaveRemotePassword.disabled = true;
      try {
        await window.bosAPI.graphics.setRemoteControlPassword(password);
        remoteControlPasswordStatus.textContent = 'Password saved. Remote browsers must enter it again.';
      } catch (error) {
        window.alert(error.message);
      } finally {
        btnSaveRemotePassword.disabled = false;
      }
    });

    remoteControlPassword.addEventListener('input', () => {
      remoteControlPasswordStatus.textContent = 'Unsaved password change. Click SAVE PASSWORD to apply it.';
    });

    btnToggleRemotePassword.addEventListener('click', () => {
      const reveal = remoteControlPassword.type === 'password';
      remoteControlPassword.type = reveal ? 'text' : 'password';
      btnToggleRemotePassword.textContent = reveal ? 'HIDE' : 'SHOW';
      btnToggleRemotePassword.setAttribute('aria-pressed', String(reveal));
    });

    remoteImmediateScore.addEventListener('change', async () => {
      remoteImmediateScore.disabled = true;
      try {
        remoteImmediateScore.checked = await window.bosAPI.graphics.setRemoteImmediateScore(
          remoteImmediateScore.checked
        );
      } catch (error) {
        remoteImmediateScore.checked = !remoteImmediateScore.checked;
        window.alert(error.message);
      } finally {
        remoteImmediateScore.disabled = false;
      }
    });

    remoteScoreRequestList.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action][data-proposal-id]');
      if (!button) return;
      button.disabled = true;
      try {
        const resolveProposal = button.dataset.action === 'approve'
          ? window.bosAPI.graphics.approveRemoteScoreProposal
          : window.bosAPI.graphics.rejectRemoteScoreProposal;
        renderRemoteScoreProposals(await resolveProposal(button.dataset.proposalId));
      } catch (error) {
        window.alert(error.message);
        button.disabled = false;
      }
    });

    inputStartTime.addEventListener('change', () => {
      const match = inputStartTime.value.trim().match(/^(\d{1,3}):(\d{2})$/);
      if (!match || Number(match[2]) > 59) {
        inputStartTime.value = masterClockDisplay.textContent;
        return;
      }
      const startSeconds = Number(match[1]) * 60 + Number(match[2]);
      window.bosAPI.match.setStartTime(startSeconds);
    });

    // Clock
    btnClockToggle.addEventListener('click', () => {
      window.bosAPI.match.clockToggle();
    });

    btnClockReset.addEventListener('click', () => {
      if (confirm('Reset match clock to 00:00?')) {
        window.bosAPI.match.clockReset();
      }
    });

    inputOffenseSeconds.addEventListener('change', () => {
      const parsedSeconds = parseInt(inputOffenseSeconds.value, 10);
      const seconds = Number.isFinite(parsedSeconds) ? Math.max(0, parsedSeconds) : 24;
      inputOffenseSeconds.value = seconds;
      window.bosAPI.match.setOffenseClock({ offenseSeconds: seconds, offenseLimitSeconds: seconds });
    });

    btnOffenseToggle.addEventListener('click', () => {
      window.bosAPI.match.toggleOffenseClock();
    });

    btnOffenseReset.addEventListener('click', () => {
      window.bosAPI.match.resetOffenseClock();
    });

    btnHeaderOffenseToggle.addEventListener('click', () => {
      window.bosAPI.match.toggleOffenseClock();
    });

    btnHeaderOffenseReset.addEventListener('click', () => {
      window.bosAPI.match.resetOffenseClock();
    });

    // Clear events
    btnClearEvents.addEventListener('click', () => {
      window.bosAPI.events.clear();
    });

  }

  async function triggerGoalSequence(team) {
    try {
      await window.bosAPI.workflow.triggerGoal(team, { points: selectedScoreValue });
    } catch (err) {
      console.warn('Could not trigger goal sequence:', err.message);
    }
  }

  function handleGoalHotkey(code) {
    if (code === homeGoalHotkey.dataset.code) {
      triggerGoalSequence('home');
      return true;
    }
    if (code === awayGoalHotkey.dataset.code) {
      triggerGoalSequence('away');
      return true;
    }
    return false;
  }

  async function loadInitialState() {
    try {
      const scores = await window.bosAPI.score.get();
      updateScoreUI(scores);

      const goalWorkflow = await window.bosAPI.config.get('goalWorkflow');
      if (goalWorkflow) {
        window.goalActionLabels = {
          home: goalWorkflow.homeGoalActionLabel || 'GOAL',
          away: goalWorkflow.awayGoalActionLabel || 'GOAL'
        };
        refreshGoalLabels();
      }

      const matchState = await window.bosAPI.match.getState();
      if (matchState) {
        selectMatchState.value = matchState.matchState;
        updateClockUI(matchState.clock);
        updateSetUI(matchState.sets);
      }

      const events = await window.bosAPI.events.get(30);
      renderEventFeed(events);
    } catch (err) {
      console.error('Error loading initial match state:', err);
    }
  }

  async function loadScorebugVisibility() {
    try {
      const centerVisible = await window.bosAPI.graphics.getScreenCenterScorebugVisible();
      updateScreenCenterScorebugButton(centerVisible);
      const visible = await window.bosAPI.graphics.getScorebugVisible();
      updateScorebugButton(visible);
    } catch (err) {
      console.error('Error loading scorebug visibility:', err);
    }
  }

  function updateScreenCenterScorebugButton(visible) {
    btnToggleScreenCenterScorebug.setAttribute('aria-pressed', String(!!visible));
    btnToggleScreenCenterScorebug.textContent = visible
      ? 'SCREEN CENTER SCOREBUG ON'
      : 'SCREEN CENTER SCOREBUG OFF';
  }

  async function loadRemoteControlInfo() {
    try {
      const info = await window.bosAPI.graphics.getRemoteControlInfo();
      const addresses = info.addresses.length ? info.addresses : ['localhost'];
      remoteControlPassword.value = info.password;
      remoteImmediateScore.checked = info.immediateScore;
      remoteControlLink.href = `http://${addresses[0]}:${info.port}/remote/`;
      remoteControlLink.textContent = remoteControlLink.href;
      remoteControlAddresses.textContent = addresses.length > 1
        ? `Other device addresses: ${addresses.slice(1).map(address => `http://${address}:${info.port}/remote/`).join(' · ')}`
        : 'Use a device connected to the same local network.';
    } catch (error) {
      remoteControlLink.textContent = 'Remote control is unavailable.';
      console.error('Failed to load browser remote details:', error);
    }
  }

  async function loadRemoteScoreProposals() {
    try {
      renderRemoteScoreProposals(await window.bosAPI.graphics.getRemoteScoreProposals());
    } catch (error) {
      console.error('Failed to load remote score requests:', error);
      remoteScoreRequestList.textContent = 'Could not load score requests.';
    }
  }

  function renderRemoteScoreProposals(proposals) {
    const pending = Array.isArray(proposals) ? proposals : [];
    remoteScoreRequestCount.textContent = pending.length;
    remoteScoreRequestList.replaceChildren();
    if (pending.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'remote-score-empty';
      empty.textContent = 'No score requests awaiting approval.';
      remoteScoreRequestList.append(empty);
      return;
    }

    const homeName = cardHomeName.textContent;
    const awayName = cardAwayName.textContent;
    pending.forEach(proposal => {
      const row = document.createElement('div');
      row.className = 'remote-score-request';

      const summary = document.createElement('div');
      summary.className = 'remote-score-request-summary';
      summary.textContent = `${homeName} ${formatScoreDelta(proposal.homeDelta)} · ${awayName} ${formatScoreDelta(proposal.awayDelta)}`;

      const source = document.createElement('div');
      source.className = 'remote-score-request-source';
      source.textContent = `Browser remote · ${new Date(proposal.submittedAt).toLocaleTimeString()}`;

      const actions = document.createElement('div');
      actions.className = 'remote-score-request-actions';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'remote-score-approve';
      approve.dataset.action = 'approve';
      approve.dataset.proposalId = proposal.id;
      approve.textContent = 'APPROVE';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'remote-score-reject';
      reject.dataset.action = 'reject';
      reject.dataset.proposalId = proposal.id;
      reject.textContent = 'REJECT';
      actions.append(approve, reject);
      row.append(summary, source, actions);
      remoteScoreRequestList.append(row);
    });
  }

  function formatScoreDelta(delta) {
    const value = Number(delta) || 0;
    return value > 0 ? `+${value}` : String(value);
  }

  function updateScorebugButton(visible) {
    const centerVisible =
      btnToggleScreenCenterScorebug.getAttribute('aria-pressed') === 'true';
    btnToggleScorebug.setAttribute('aria-pressed', String(!!visible));
    btnToggleScorebug.disabled = centerVisible;
    btnToggleScorebug.textContent = visible ? 'FADE SCORE BUG OUT' : 'FADE SCORE BUG IN';
    if (centerVisible) {
      btnToggleScorebug.classList.add('locked');
    } else {
      btnToggleScorebug.classList.remove('locked');
    }
  }

  function updateScreenCenterScorebugButton(visible) {
    btnToggleScreenCenterScorebug.setAttribute('aria-pressed', String(!!visible));
    btnToggleScreenCenterScorebug.textContent = visible
      ? 'FADE CENTER SCOREBUG OUT'
      : 'FADE CENTER SCOREBUG IN';
  }

  function listenIpc() {
    window.bosAPI.score.onChanged((data) => {
      updateScoreUI(data.state);
    });

    window.bosAPI.score.onTeamsUpdated((scores) => {
      updateScoreUI(scores);
    });

    window.bosAPI.graphics.onRemoteScoreProposalsChanged((proposals) => {
      renderRemoteScoreProposals(proposals);
    });

    window.bosAPI.match.onClockTick((clock) => {
      updateClockUI(clock);
    });

    window.bosAPI.match.onClockChanged((clock) => {
      updateClockUI(clock);
    });

    window.bosAPI.match.onOffenseChanged((state) => {
      updateOffenseTimerUI(state);
    });

    window.bosAPI.match.onSetsChanged((sets) => {
      updateSetUI(sets);
    });

    window.bosAPI.match.onStateChanged((data) => {
      selectMatchState.value = data.current;
    });

    window.bosAPI.events.onAdded((evt) => {
      prependEventItem(evt);
    });

    window.bosAPI.events.onCleared(() => {
      eventFeedList.innerHTML = '<div class="empty-queue-hint">No events logged</div>';
    });
  }

  function updateScoreUI(scores) {
    if (!scores) return;
    if (scores.home) {
      displayHomeScore.textContent = scores.home.score;
      cardHomeName.textContent = scores.home.name;
      btnGarnetGoal.querySelector('.btn-text').textContent =
        `${scores.home.name} ${window.goalActionLabels?.home || 'GOAL'}`;
      updateTeamHotkey(btnGarnetGoal, homeGoalHotkey, scores.home, 'KeyG');
      applyTeamBranding('home', scores.home);
      btnAwardSetHome.textContent = `AWARD SET TO ${scores.home.name}`;
    }
    if (scores.away) {
      displayAwayScore.textContent = scores.away.score;
      cardAwayName.textContent = scores.away.name;
      btnTopazGoal.querySelector('.btn-text').textContent =
        `${scores.away.name} ${window.goalActionLabels?.away || 'GOAL'}`;
      updateTeamHotkey(btnTopazGoal, awayGoalHotkey, scores.away, 'KeyT');
      applyTeamBranding('away', scores.away);
      btnAwardSetAway.textContent = `AWARD SET TO ${scores.away.name}`;
    }
  }

  function updateTeamHotkey(button, pill, team, fallback) {
    const code = team.hotkey || fallback;
    pill.dataset.code = code;
    pill.textContent = code.replace(/^Key/, '').replace(/^Digit/, '');
    button.title = `Goal hotkey: ${pill.textContent}`;
  }

  function refreshGoalLabels() {
    btnGarnetGoal.querySelector('.btn-text').textContent =
      `${cardHomeName.textContent} ${window.goalActionLabels.home}`;
    btnTopazGoal.querySelector('.btn-text').textContent =
      `${cardAwayName.textContent} ${window.goalActionLabels.away}`;
  }

  function applyTeamBranding(side, team) {
    const goalButton = side === 'home' ? btnGarnetGoal : btnTopazGoal;
    const teamLabel = side === 'home' ? cardHomeName : cardAwayName;
    const color = team.color || (side === 'home' ? '#e11d48' : '#eab308');
    goalButton.style.setProperty('--team-color', color);
    goalButton.style.setProperty('--team-secondary-color', team.secondaryColor || color);
    teamLabel.style.setProperty('--team-color', color);
  }

  function updateClockUI(clock) {
    if (!clock) return;
    const noTime = clock.mode === 'none';
    masterClockDisplay.textContent = clock.formatted;
    masterPeriodDisplay.textContent = `${clock.period.toUpperCase()} ${clock.stoppageTime}`;
    selectPeriod.value = clock.period;
    if (!noTime && document.activeElement !== inputStartTime) inputStartTime.value = clock.formatted;
    regulationTimeControl.hidden = noTime;
    startTimeControl.hidden = noTime;
    additionalTimeModeControl.hidden = noTime;
    stoppageTimeControl.hidden = noTime;
    updateSportControls(clock.mode);

    // Timer mode + set time (don't clobber the input while the operator is typing)
    if (clock.mode) selectTimerMode.value = clock.mode;
    if (clock.additionalTimeMode) selectAdditionalTimeMode.value = clock.additionalTimeMode;
    btnApproveAddedTime.classList.toggle('hidden', !clock.awaitingStoppageApproval);
    if (clock.awaitingStoppageApproval) {
      btnApproveAddedTime.textContent = `GO AHEAD +${clock.stoppageMinutes} MIN`;
    }
    if (clock.regulationSeconds && document.activeElement !== inputRegulationMin) {
      inputRegulationMin.value = Math.round(clock.regulationSeconds / 60);
    }
    if (clock.offense && document.activeElement !== inputOffenseSeconds) {
      inputOffenseSeconds.value = clock.offense.limitSeconds ?? clock.offense.seconds ?? 24;
    }
    updateOffenseTimerUI(clock.offense || clock.offenseTimer || { running: false, seconds: 24, limitSeconds: 24, active: false });

    // Additional-time overlay below the frozen clock (00:00 counting up to N:00)
    if (!noTime && clock.inStoppage && clock.stoppageDisplay) {
      masterStoppageDisplay.textContent = clock.stoppageDisplay;
      masterStoppageDisplay.classList.remove('hidden');
    } else {
      masterStoppageDisplay.classList.add('hidden');
    }

    // Toggle button icon
    if (clock.running) {
      btnClockToggle.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      masterClockDisplay.style.color = '#4ade80';
    } else {
      btnClockToggle.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      masterClockDisplay.style.color = '#38bdf8';
    }
    btnClockToggle.disabled = noTime || !!clock.awaitingStoppageApproval;
    btnClockReset.disabled = noTime;
    btnClockToggle.title = clock.awaitingStoppageApproval
      ? 'Use GO AHEAD to start additional time'
      : noTime ? 'Clock is disabled in no-time mode' : 'Spacebar: Start/Pause';
  }

  function updateSportControls(mode) {
    const basketballMode = mode === 'countdown';
    const activeMode = document.body.dataset.activeMode;
    offenseTimerControl.hidden = !basketballMode;
    offenseClockHeader.hidden = !basketballMode;
    volleyballSetsControl.hidden = activeMode
      ? activeMode !== 'volleyball'
      : basketballMode;
    btnResetScore.textContent = activeMode
      ? activeMode === 'volleyball' ? 'RESET SCORE + SETS' : 'RESET SCORE'
      : basketballMode ? 'RESET SCORE' : 'RESET SCORE + SETS';
  }

  function updateOffenseTimerUI(offenseState) {
    if (!offenseState) return;
    const offenseActive = offenseState.enabled === true && Number(offenseState.limitSeconds) > 0;
    const basketballMode = selectTimerMode.value === 'countdown';
    updateSportControls(selectTimerMode.value);
    offenseClockHeader.hidden = !basketballMode || offenseState.enabled !== true;
    btnOffenseToggle.disabled = !offenseActive;
    btnOffenseReset.disabled = !offenseActive;
    btnHeaderOffenseToggle.disabled = !offenseActive;
    btnHeaderOffenseReset.disabled = !offenseActive;
    btnOffenseToggle.textContent = offenseState.running ? 'PAUSE' : 'START';
    btnHeaderOffenseToggle.textContent = offenseState.running ? 'PAUSE' : 'START';
    btnHeaderOffenseToggle.setAttribute('aria-label', offenseState.running ? 'Pause offense timer' : 'Start offense timer');
    offenseTimerDisplay.textContent = offenseState.display || '00:00';
    headerOffenseDisplay.textContent = offenseState.seconds ?? 0;
    if (document.activeElement !== inputOffenseSeconds) {
      inputOffenseSeconds.value = offenseState.limitSeconds ?? 24;
    }
  }

  async function completeSet(winner) {
    try {
      const sets = await window.bosAPI.match.completeSet(winner);
      updateSetUI(sets);
      const completedSet = sets.completedSets[sets.completedSets.length - 1];
      await window.bosAPI.graphics.showLowerThird({
        title: `SET WON BY: ${completedSet.team}`,
        duration: 5
      });
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function removeCompletedSet(setNumber) {
    if (!window.confirm(`Remove Set ${setNumber} from the results?`)) return;
    try {
      updateSetUI(await window.bosAPI.match.removeCompletedSet(setNumber));
    } catch (err) {
      window.alert(err.message);
    }
  }

  function updateSetUI(sets) {
    if (!sets) return;
    inputBestOfSets.value = sets.bestOfSets;
    homeSetsWon.textContent = sets.homeSets;
    awaySetsWon.textContent = sets.awaySets;
    setTallyAdjustButtons.forEach(button => {
      const teamTally = button.dataset.team === 'home' ? sets.homeSets : sets.awaySets;
      button.disabled = button.dataset.amount === '-1' && teamTally === 0;
    });
    const completed = sets.completedSets || [];
    completedSetsList.replaceChildren();
    if (!completed.length) {
      completedSetsList.textContent = 'No sets completed';
    } else {
      completed.forEach(set => {
        const row = document.createElement('div');
        row.className = 'completed-set-entry';
        const label = document.createElement('span');
        const points = set.points ? ` (${set.points.home}–${set.points.away})` : '';
        label.textContent = `SET ${set.number}: ${set.team}${points}`;
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'text-btn completed-set-remove';
        removeButton.textContent = 'REMOVE';
        removeButton.setAttribute('aria-label', `Remove set ${set.number}`);
        removeButton.addEventListener('click', () => removeCompletedSet(set.number));
        row.append(label, removeButton);
        completedSetsList.append(row);
      });
    }
    const seriesComplete = completed.length >= sets.bestOfSets;
    btnAwardSetHome.disabled = seriesComplete;
    btnAwardSetAway.disabled = seriesComplete;
  }

  function renderEventFeed(events) {
    if (!events || events.length === 0) {
      eventFeedList.innerHTML = '<div class="empty-queue-hint">No events logged</div>';
      return;
    }
    eventFeedList.innerHTML = '';
    events.forEach(evt => appendEventItem(evt));
  }

  function prependEventItem(evt) {
    const emptyHint = eventFeedList.querySelector('.empty-queue-hint');
    if (emptyHint) emptyHint.remove();

    const div = createEventItemNode(evt);
    eventFeedList.insertBefore(div, eventFeedList.firstChild);
  }

  function appendEventItem(evt) {
    const div = createEventItemNode(evt);
    eventFeedList.appendChild(div);
  }

  function createEventItemNode(evt) {
    const div = document.createElement('div');
    div.className = 'event-item';
    const isGoal = evt.type === 'GOAL';
    div.innerHTML = `
      <span class="event-time">${evt.displayTime || ''}</span>
      <span class="event-type-badge ${isGoal ? 'goal' : ''}">${evt.type}</span>
      <span style="font-weight: 700; font-size: 11px;">${evt.team ? evt.team : (evt.time || evt.period || '')}</span>
    `;
    return div;
  }

  return { init, triggerGoalSequence, handleGoalHotkey, refreshGoalLabels };
})();
