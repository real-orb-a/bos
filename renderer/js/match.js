// Match Controls & Event Logging Module
window.MatchModule = (function() {
  const btnGarnetGoal = document.getElementById('btn-garnet-goal');
  const btnTopazGoal = document.getElementById('btn-topaz-goal');
  const btnAddHome = document.getElementById('btn-add-home');
  const btnSubHome = document.getElementById('btn-sub-home');
  const btnAddAway = document.getElementById('btn-add-away');
  const btnSubAway = document.getElementById('btn-sub-away');
  const btnResetScore = document.getElementById('btn-reset-score');
  const displayHomeScore = document.getElementById('display-home-score');
  const displayAwayScore = document.getElementById('display-away-score');
  const cardHomeName = document.getElementById('card-home-name');
  const cardAwayName = document.getElementById('card-away-name');

  const selectMatchState = document.getElementById('select-match-state');
  const selectPeriod = document.getElementById('select-period');
  const stoppageButtons = document.querySelectorAll('.stoppage-btn');

  const btnClockToggle = document.getElementById('btn-clock-toggle');
  const btnClockReset = document.getElementById('btn-clock-reset');
  const masterClockDisplay = document.getElementById('master-clock-display');
  const masterPeriodDisplay = document.getElementById('master-period-display');

  const eventFeedList = document.getElementById('event-feed-list');
  const btnClearEvents = document.getElementById('btn-clear-events');
  const btnSwitchLiveScene = document.getElementById('btn-switch-live-scene');

  function init() {
    bindEvents();
    loadInitialState();
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

    // Score adjustments
    btnAddHome.addEventListener('click', () => window.bosAPI.score.addHome(1));
    btnSubHome.addEventListener('click', () => window.bosAPI.score.subtractHome(1));
    btnAddAway.addEventListener('click', () => window.bosAPI.score.addAway(1));
    btnSubAway.addEventListener('click', () => window.bosAPI.score.subtractAway(1));
    btnResetScore.addEventListener('click', () => {
      if (confirm('Reset match score to 0 - 0?')) {
        window.bosAPI.score.reset();
      }
    });

    // Match State
    selectMatchState.addEventListener('change', (e) => {
      window.bosAPI.match.setState(e.target.value);
    });

    // Period
    selectPeriod.addEventListener('change', (e) => {
      window.bosAPI.match.setPeriod(e.target.value);
    });

    // Stoppage buttons
    stoppageButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        stoppageButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const min = parseInt(btn.dataset.min, 10);
        window.bosAPI.match.setClock({ stoppageMinutes: min });
      });
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

    // Quick switch to Live Scene
    btnSwitchLiveScene.addEventListener('click', async () => {
      const config = await window.bosAPI.config.get('scenes');
      const liveScene = config?.liveScene || 'LIVE';
      await window.bosAPI.obs.switchScene(liveScene);
    });
  }

  async function triggerGoalSequence(team) {
    try {
      await window.bosAPI.workflow.triggerGoal(team, {});
    } catch (err) {
      console.warn('Could not trigger goal sequence:', err.message);
    }
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
    }
    if (scores.away) {
      displayAwayScore.textContent = scores.away.score;
      cardAwayName.textContent = scores.away.name;
      btnTopazGoal.querySelector('.btn-text').textContent = `${scores.away.name} GOAL`;
    }
  }

  function updateClockUI(clock) {
    if (!clock) return;
    masterClockDisplay.textContent = clock.formatted;
    masterPeriodDisplay.textContent = `${clock.period.toUpperCase()} ${clock.stoppageTime}`;
    selectPeriod.value = clock.period;

    // Toggle button icon
    if (clock.running) {
      btnClockToggle.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
      masterClockDisplay.style.color = '#4ade80';
    } else {
      btnClockToggle.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      masterClockDisplay.style.color = '#38bdf8';
    }
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

  return { init, triggerGoalSequence };
})();
