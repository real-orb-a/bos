(function() {
  const homeScoreEl = document.getElementById('home-score');
  const awayScoreEl = document.getElementById('away-score');
  const homeShortEl = document.getElementById('home-short');
  const awayShortEl = document.getElementById('away-short');
  const homeNameEl = document.getElementById('home-name');
  const awayNameEl = document.getElementById('away-name');
  const homeBarEl = document.getElementById('home-bar');
  const awayBarEl = document.getElementById('away-bar');
  const clockEl = document.getElementById('clock-display');
  const periodEl = document.getElementById('period-display');
  const stoppageEl = document.getElementById('stoppage-display');
  const scorebug = document.getElementById('score-bug');

  let currentHomeScore = 0;
  let currentAwayScore = 0;

  function updateDisplay(data, anim = 'pop', changedTeam = null) {
    if (!data) return;

    if (data.home) {
      homeShortEl.textContent = data.home.short || 'GAR';
      homeNameEl.textContent = data.home.name || 'GARNET';
      if (data.home.color) homeBarEl.style.backgroundColor = data.home.color;
      
      const newHome = data.home.score !== undefined ? data.home.score : currentHomeScore;
      if (newHome !== currentHomeScore || changedTeam === 'home' || changedTeam === 'both') {
        currentHomeScore = newHome;
        homeScoreEl.textContent = currentHomeScore;
        triggerAnimation(homeScoreEl, anim);
      }
    }

    if (data.away) {
      awayShortEl.textContent = data.away.short || 'TOP';
      awayNameEl.textContent = data.away.name || 'TOPAZ';
      if (data.away.color) awayBarEl.style.backgroundColor = data.away.color;

      const newAway = data.away.score !== undefined ? data.away.score : currentAwayScore;
      if (newAway !== currentAwayScore || changedTeam === 'away' || changedTeam === 'both') {
        currentAwayScore = newAway;
        awayScoreEl.textContent = currentAwayScore;
        triggerAnimation(awayScoreEl, anim);
      }
    }

    if (data.clock) {
      applyClock(data.clock);
    }
  }

  function applyClock(clock) {
    clockEl.textContent = clock.formatted || '00:00';
    if (clock.period) {
      periodEl.textContent = clock.period.toUpperCase();
    }
    // Additional-time overlay: appears below the frozen clock and counts from 00:00.
    if (clock.inStoppage && clock.stoppageDisplay) {
      stoppageEl.textContent = clock.stoppageDisplay;
      stoppageEl.classList.remove('hidden');
    } else {
      stoppageEl.classList.add('hidden');
    }
  }

  function triggerAnimation(el, animType) {
    const cls = animType === 'flip' ? 'score-flip' : 'score-pop';
    el.classList.remove('score-pop', 'score-flip');
    // Force reflow
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // Connect to BOS WebSocket server
  function connectWebSocket() {
    const wsUrl = `ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`;
    console.log('[ScoreBug] Connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INITIAL_SYNC') {
          if (msg.score) {
            updateDisplay(msg.score, 'none');
          }
          setScorebugVisible(msg.scorebugVisible !== false);
        } else if (msg.type === 'SCORE_UPDATE') {
          updateDisplay(msg, msg.animation || 'pop', msg.changedTeam);
        } else if (msg.type === 'SCOREBUG_VISIBILITY') {
          setScorebugVisible(msg.visible);
        } else if (msg.type === 'CLOCK_UPDATE') {
          if (msg.clock) {
            applyClock(msg.clock);
          }
        }
      } catch (err) {
        console.error('[ScoreBug] Message parse error:', err);
      }
    };

    ws.onclose = () => {
      console.warn('[ScoreBug] Disconnected. Reconnecting in 2s...');
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (e) => {
      console.warn('[ScoreBug] WebSocket error:', e);
    };
  }

  function setScorebugVisible(visible) {
    scorebug.classList.toggle('faded-out', !visible);
  }

  connectWebSocket();
})();
