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
    btnResetScore.addEventListener('click', () => {
      if (confirm('Reset match score to 0 - 0?')) {
        window.bosAPI.score.reset();
      }
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

    btnClockReset.addEventListener('click', () => {
      if (confirm('Reset match clock to 00:00?')) {
        window.bosAPI.match.clockReset();
      }
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
    teamLabel.style.setProperty('--team-color', color);
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

    // Toggle button icon
    if (clock.running) {
      btnClockToggle.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      masterClockDisplay.style.color = '#4ade80';
    } else {
      btnClockToggle.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      masterClockDisplay.style.color = '#38bdf8';
    }
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

  return { init, triggerGoalSequence, handleGoalHotkey };
})();
