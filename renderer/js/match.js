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
  const displayHomeScore = document.getElementById('display-home-score');
  const displayAwayScore = document.getElementById('display-away-score');
  const cardHomeName = document.getElementById('card-home-name');
  const cardAwayName = document.getElementById('card-away-name');
  const homeGoalHotkey = document.getElementById('home-goal-hotkey');
  const awayGoalHotkey = document.getElementById('away-goal-hotkey');
  let selectedScoreValue = 1;
  const MAX_FEED_ITEMS = 100;

  const selectMatchState = document.getElementById('select-match-state');
  const selectPeriod = document.getElementById('select-period');
  const inputStartTime = document.getElementById('input-start-time');
  const stoppageButtons = document.querySelectorAll('.stoppage-btn');

  const btnClockToggle = document.getElementById('btn-clock-toggle');
  const btnClockReset = document.getElementById('btn-clock-reset');
  const masterClockDisplay = document.getElementById('master-clock-display');
  const masterPeriodDisplay = document.getElementById('master-period-display');
  const masterStoppageDisplay = document.getElementById('master-stoppage-display');
  const selectTimerMode = document.getElementById('select-timer-mode');
  const selectAdditionalTimeMode = document.getElementById('select-additional-time-mode');
  const btnApproveAddedTime = document.getElementById('btn-approve-added-time');
  const inputRegulationMin = document.getElementById('input-regulation-min');

  const eventFeedList = document.getElementById('event-feed-list');
  const btnClearEvents = document.getElementById('btn-clear-events');

  function init() {
    bindEvents();
    loadInitialState();
    loadScorebugVisibility();
    listenIpc();
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
    btnResetScore.addEventListener('click', async () => {
      const ok = await window.BOSUI.confirm({
        title: 'Reset score?',
        message: 'This sets both teams back to 0 and cannot be undone.',
        confirmLabel: 'RESET SCORE'
      });
      if (ok) window.bosAPI.score.reset();
    });

    btnToggleScorebug.addEventListener('click', async () => {
      const currentlyVisible = btnToggleScorebug.getAttribute('aria-pressed') === 'true';
      const visible = await window.bosAPI.graphics.setScorebugVisible(!currentlyVisible);
      updateScorebugButton(visible);
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

    btnClockReset.addEventListener('click', async () => {
      const ok = await window.BOSUI.confirm({
        title: 'Reset match clock?',
        message: 'The clock returns to its configured start time. Added time is cleared.',
        confirmLabel: 'RESET CLOCK'
      });
      if (ok) window.bosAPI.match.clockReset();
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
      window.BOSUI.toast('The goal sequence could not start. Check the OBS connection and try again.', { type: 'error' });
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

      const matchState = await window.bosAPI.match.getState();
      if (matchState) {
        selectMatchState.value = matchState.matchState;
        updateClockUI(matchState.clock);
      }

      const events = await window.bosAPI.events.get(30);
      renderEventFeed(events);
    } catch (err) {
      console.error('Error loading initial match state:', err);
    }
  }

  async function loadScorebugVisibility() {
    try {
      const visible = await window.bosAPI.graphics.getScorebugVisible();
      updateScorebugButton(visible);
    } catch (err) {
      console.error('Error loading scorebug visibility:', err);
    }
  }

  function updateScorebugButton(visible) {
    btnToggleScorebug.setAttribute('aria-pressed', String(!!visible));
    btnToggleScorebug.textContent = visible ? 'FADE SCORE BUG OUT' : 'FADE SCORE BUG IN';
  }

  function listenIpc() {
    window.bosAPI.score.onChanged((data) => {
      updateScoreUI(data.state);
    });

    window.bosAPI.score.onTeamsUpdated((scores) => {
      updateScoreUI(scores);
    });

    window.bosAPI.match.onClockTick((clock) => {
      updateClockUI(clock);
    });

    window.bosAPI.match.onClockChanged((clock) => {
      updateClockUI(clock);
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
      btnGarnetGoal.querySelector('.btn-text').textContent = `${scores.home.name} GOAL`;
      updateTeamHotkey(btnGarnetGoal, homeGoalHotkey, scores.home, 'KeyG');
      applyTeamBranding('home', scores.home);
    }
    if (scores.away) {
      displayAwayScore.textContent = scores.away.score;
      cardAwayName.textContent = scores.away.name;
      btnTopazGoal.querySelector('.btn-text').textContent = `${scores.away.name} GOAL`;
      updateTeamHotkey(btnTopazGoal, awayGoalHotkey, scores.away, 'KeyT');
      applyTeamBranding('away', scores.away);
    }
  }

  function updateTeamHotkey(button, pill, team, fallback) {
    const code = team.hotkey || fallback;
    pill.dataset.code = code;
    pill.textContent = code.replace(/^Key/, '').replace(/^Digit/, '');
    button.title = `Goal hotkey: ${pill.textContent}`;
  }

  function applyTeamBranding(side, team) {
    const goalButton = side === 'home' ? btnGarnetGoal : btnTopazGoal;
    const teamLabel = side === 'home' ? cardHomeName : cardAwayName;
    const color = team.color || (side === 'home' ? '#e11d48' : '#eab308');
    goalButton.style.setProperty('--team-color', color);
    goalButton.style.setProperty('--team-secondary-color', team.secondaryColor || color);
    goalButton.style.setProperty('--team-contrast', readableTextColor(color));
    teamLabel.style.setProperty('--team-color', color);
  }

  // Pick black or white text so any house colour (e.g. Topaz yellow) stays legible.
  function readableTextColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.19 ? '#14110a' : '#ffffff';
  }

  function updateClockUI(clock) {
    if (!clock) return;
    masterClockDisplay.textContent = clock.formatted;
    masterPeriodDisplay.textContent = `${clock.period.toUpperCase()} ${clock.stoppageTime}`;
    selectPeriod.value = clock.period;
    if (document.activeElement !== inputStartTime) inputStartTime.value = clock.formatted;

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

    // Additional-time overlay below the frozen clock (00:00 counting up to N:00)
    if (clock.inStoppage && clock.stoppageDisplay) {
      masterStoppageDisplay.textContent = clock.stoppageDisplay;
      masterStoppageDisplay.classList.remove('hidden');
    } else {
      masterStoppageDisplay.classList.add('hidden');
    }

    // Toggle button icon + running colour (colour comes from CSS, not inline styles)
    btnClockToggle.innerHTML = clock.running
      ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>'
      : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z"/></svg>';
    masterClockDisplay.classList.toggle('is-running', !!clock.running);
    btnClockToggle.disabled = !!clock.awaitingStoppageApproval;
    btnClockToggle.title = clock.awaitingStoppageApproval
      ? 'Use GO AHEAD to start additional time'
      : 'Spacebar: Start/Pause';
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
    // Keep the DOM small during long matches (the main process keeps the full log).
    while (eventFeedList.children.length > MAX_FEED_ITEMS) eventFeedList.removeChild(eventFeedList.lastChild);
  }

  function appendEventItem(evt) {
    const div = createEventItemNode(evt);
    eventFeedList.appendChild(div);
  }

  function createEventItemNode(evt) {
    const div = document.createElement('div');
    div.className = 'event-item';
    const isGoal = evt.type === 'GOAL';

    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = evt.displayTime || '';

    const badge = document.createElement('span');
    badge.className = `event-type-badge${isGoal ? ' goal' : ''}`;
    badge.textContent = evt.type;

    const meta = document.createElement('span');
    meta.className = 'event-meta';
    meta.textContent = evt.team ? evt.team : (evt.time || evt.period || '');

    div.append(time, badge, meta);
    return div;
  }

  return { init, triggerGoalSequence, handleGoalHotkey };
})();
