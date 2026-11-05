(function() {
  const homeScoreEl = document.getElementById('home-score');
  const awayScoreEl = document.getElementById('away-score');
  const homeShortEl = document.getElementById('home-short');
  const awayShortEl = document.getElementById('away-short');
  const homeNameEl = document.getElementById('home-name');
  const awayNameEl = document.getElementById('away-name');
  const homeLogoEl = document.getElementById('home-logo');
  const awayLogoEl = document.getElementById('away-logo');
  const homeTeamEl = document.getElementById('team-home');
  const awayTeamEl = document.getElementById('team-away');
  const clockEl = document.getElementById('clock-display');
  const periodEl = document.getElementById('period-display');
  const setsEl = document.getElementById('sets-value');
  const setsLabelEl = document.getElementById('sets-label');
  const volleyballPointsEl = document.getElementById('volleyball-points-display');
  const cricketDisplayEl = document.getElementById('cricket-display');
  const cricketInningsEl = document.getElementById('cricket-innings-display');
  const cricketStatsEl = document.getElementById('cricket-stats-display');
  const stoppageEl = document.getElementById('stoppage-display');
  const offenseEl = document.getElementById('offense-display');
  const offenseClockEl = document.getElementById('offense-clock-display');
  const offenseBannerEl = document.getElementById('offense-banner');
  const periodBannerEl = document.getElementById('period-banner');
  const scorebug = document.getElementById('score-bug');
  const matchNameEl = document.getElementById('match-name');
  const homeHouseSubtitleEl = document.getElementById('home-house-subtitle');
  const awayHouseSubtitleEl = document.getElementById('away-house-subtitle');
  const athleticsPanel = document.getElementById('athletics-standings');
  const athleticsCompetitionEl = document.getElementById('athletics-competition');
  const athleticsEventEl = document.getElementById('athletics-event-title');
  const athleticsResultsEl = document.getElementById('athletics-result-list');

  let currentHomeScore = 0;
  let currentAwayScore = 0;
  let currentTimerMode = null;
  let sportScorebug = null;
  let athleticsRankEventId = null;
  let athleticsPreviousPlaces = new Map();
  let athleticsExpanded = false;
  let athleticsRelayMode = 'compact';
  let latestAthleticsStandings = null;
  const relayTickerStates = new Map();
  let relayRunnerIndexes = {};
  const teamData = { home: null, away: null };
  const garnetBrand = { short: 'GAR', name: 'GARNET', logo: 'assets/houses/garnet.png' };
  const emeraldBrand = { short: 'EME', name: 'EMERALD', logo: 'assets/houses/emerald.png' };
  const topazBrand = { short: 'TOP', name: 'TOPAZ', logo: 'assets/houses/topaz.png' };
  const houseBrands = {
    GARNET: garnetBrand,
    GAR: garnetBrand,
    EMERALD: emeraldBrand,
    EME: emeraldBrand,
    TOPAZ: topazBrand,
    TOP: topazBrand
  };

  function resolveHouseBrand(name) {
    const normalized = String(name || '').trim().toUpperCase()
      .replace(/\s+HOUSE$/, '')
      .replace(/\s+/g, ' ');
    return houseBrands[normalized] || null;
  }

  // Build a broadcast short code from a player's full name, e.g.
  // "John Smith" -> "J. SMITH", "Maria" -> "MARIA", "Roger Federer" -> "R. FEDERER"
  function playerShortCode(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].toUpperCase().slice(0, 6);
    return parts.map((p, i) =>
      i === parts.length - 1 ? p.toUpperCase() : p[0].toUpperCase() + '.'
    ).join(' ');
  }

  function racketPlayers(side) {
    if (!['table-tennis', 'badminton'].includes(sportScorebug?.mode)) return [];
    const names = side === 'home' ? sportScorebug.homePlayers : sportScorebug.awayPlayers;
    return Array.isArray(names) ? names : [];
  }

  function racketPlayerName(player) {
    return typeof player === 'string' ? player : String(player?.name || '');
  }

  function racketPlayerCode(player) {
    if (player && typeof player === 'object' && player.shortCode) {
      return String(player.shortCode).trim().slice(0, 3).toUpperCase();
    }
    return playerShortCode(racketPlayerName(player)).replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase();
  }

  function updateTeamIdentity(data, side) {
    const isHome = side === 'home';
    const shortEl = isHome ? homeShortEl : awayShortEl;
    const nameEl = isHome ? homeNameEl : awayNameEl;
    const logoEl = isHome ? homeLogoEl : awayLogoEl;
    const teamEl = isHome ? homeTeamEl : awayTeamEl;
    teamData[side] = data;
    const fallbackName = isHome ? 'GARNET' : 'TOPAZ';
    const fallbackShort = isHome ? 'GAR' : 'TOP';
    const name = data.name || fallbackName;
    const brand = resolveHouseBrand(name) || resolveHouseBrand(data.short);
    const playerNames = racketPlayers(side);
    const isRacketSport = ['table-tennis', 'badminton'].includes(sportScorebug?.mode);
    const houseSubtitleEl = isHome ? homeHouseSubtitleEl : awayHouseSubtitleEl;
    if (isRacketSport) {
      const teamShort = data.short || (isHome ? sportScorebug.homeShort : sportScorebug.awayShort) || brand?.short || fallbackShort;
      shortEl.replaceChildren();
      if (playerNames.length) {
        playerNames.forEach(player => {
          const badge = document.createElement('span');
          badge.className = 'player-shortcode-badge';
          badge.textContent = racketPlayerCode(player);
          shortEl.appendChild(badge);
        });
      } else {
        shortEl.textContent = teamShort;
      }
      nameEl.textContent = playerNames.map(racketPlayerName).join('   ·   ') || name;
      houseSubtitleEl.textContent = `${name} (${teamShort})`;
      houseSubtitleEl.classList.remove('hidden');
    } else {
      shortEl.replaceChildren();
      shortEl.textContent = brand?.short || data.short || fallbackShort;
      nameEl.textContent = brand?.name || name;
      houseSubtitleEl.classList.add('hidden');
    }
    if (data.color) teamEl.style.setProperty('--team-color', data.color);

    const logo = data.logo || brand?.logo || '';
    if (logo) {
      logoEl.src = logo;
      logoEl.classList.add('has-logo');
    } else {
      logoEl.removeAttribute('src');
      logoEl.classList.remove('has-logo');
    }
    logoEl.alt = `${brand?.name || name} logo`;
  }

  function updateDisplay(data, anim = 'pop', changedTeam = null) {
    if (!data) return;

    if (data.home) {
      updateTeamIdentity(data.home, 'home');
      
      const newHome = data.home.score !== undefined ? data.home.score : currentHomeScore;
      if (newHome !== currentHomeScore || changedTeam === 'home' || changedTeam === 'both') {
        currentHomeScore = newHome;
        homeScoreEl.textContent = currentHomeScore;
        triggerAnimation(homeScoreEl, anim);
      }
    }

    if (data.away) {
      updateTeamIdentity(data.away, 'away');

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
    if (data.sets) applySets(data.sets);
    if (data.offense) applyOffense(data.offense);
    if ('sportScorebug' in data) applySportScorebug(data.sportScorebug);
  }

  function applySets(sets, label = 'SETS') {
    setsEl.textContent = `${sets.homeSets}-${sets.awaySets}`;
    setsLabelEl.textContent = label;
  }

  function applyClock(clock) {
    clockEl.textContent = clock.formatted || '00:00';
    currentTimerMode = clock.mode;
    scorebug.classList.toggle('no-clock-mode', clock.mode === 'none');
    if (clock.offenseTimer || clock.offense) {
      applyOffense(clock.offenseTimer || clock.offense);
    }
    if (clock.period) {
      periodEl.textContent = clock.period.toUpperCase();
      periodBannerEl.textContent = periodEl.textContent;
    }
    // Additional-time overlay: appears below the frozen clock and counts from 00:00.
    if (clock.inStoppage && clock.stoppageDisplay) {
      stoppageEl.textContent = clock.stoppageDisplay;
      stoppageEl.classList.remove('hidden');
    } else {
      stoppageEl.classList.add('hidden');
    }
  }

  function applyOffense(offense) {
    const active = currentTimerMode === 'countdown' && offense.enabled === true;
    offenseEl.classList.toggle('hidden', !active);
    offenseBannerEl.classList.toggle('hidden', !active);
    scorebug.classList.toggle('offense-active', active);
    offenseClockEl.textContent = offense.seconds ?? offense.elapsedSeconds ?? 0;
    // When the offense banner is active, the period label moves into it
    // (sitting below the timer as an add-on), so hide the standalone period
    // display to avoid duplicating it.
    periodEl.classList.toggle('hidden', active);
    if (!active) periodBannerEl.textContent = periodEl.textContent;
  }

  function applySportScorebug(state) {
    sportScorebug = state && typeof state === 'object' ? state : null;
    scorebug.classList.toggle('volleyball-mode', sportScorebug?.mode === 'volleyball');
    scorebug.classList.toggle('volleyball-scorebug', sportScorebug?.mode === 'volleyball');
    scorebug.classList.toggle('cricket-mode', sportScorebug?.mode === 'cricket');
    scorebug.classList.toggle('games-mode', ['games', 'badminton'].includes(sportScorebug?.mode));
    scorebug.classList.toggle('racket-mode', ['table-tennis', 'badminton'].includes(sportScorebug?.mode));
    if (teamData.home) updateTeamIdentity(teamData.home, 'home');
    if (teamData.away) updateTeamIdentity(teamData.away, 'away');
    volleyballPointsEl.classList.toggle('hidden', sportScorebug?.mode !== 'volleyball');
    cricketDisplayEl.classList.toggle('hidden', sportScorebug?.mode !== 'cricket');
    if (sportScorebug?.mode === 'volleyball') {
      volleyballPointsEl.textContent = `${currentHomeScore} - ${currentAwayScore}`;
      applySets(
        { homeSets: sportScorebug.homeSets, awaySets: sportScorebug.awaySets },
        'SETS'
      );
    } else if (sportScorebug?.mode === 'cricket') {
      cricketInningsEl.textContent = sportScorebug.period.toUpperCase();
      cricketStatsEl.textContent =
        `W ${sportScorebug.homeWickets}-${sportScorebug.awayWickets} · O ${sportScorebug.homeOvers}-${sportScorebug.awayOvers}`;
    } else if (['games', 'badminton'].includes(sportScorebug?.mode)) {
      applySets(
        { homeSets: sportScorebug.homeSets, awaySets: sportScorebug.awaySets },
        'GAMES'
      );
    } else if (sportScorebug?.mode === 'table-tennis') {
      applySets(
        { homeSets: sportScorebug.homeSets, awaySets: sportScorebug.awaySets },
        'SETS'
      );
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
          if (msg.score && msg.score.sets) applySets(msg.score.sets);
          if (msg.offense) applyOffense(msg.offense);
          setScorebugVisible(msg.scorebugVisible !== false);
          setScorebugExpanded(msg.scorebugExpanded === true, msg.athleticsRelayMode);
          setScorebugMatchName(msg.scorebugMatchName || '');
          applySportScorebug(msg.sportScorebug);
          relayRunnerIndexes = { ...(msg.athleticsRelayRunnerIndexes || {}) };
          applyAthleticsStandings(msg.athleticsStandings);
        } else if (msg.type === 'SCORE_UPDATE') {
          updateDisplay(msg, msg.animation || 'pop', msg.changedTeam);
        } else if (msg.type === 'SPORT_SCOREBUG_UPDATE') {
          applySportScorebug(msg.sportScorebug);
        } else if (msg.type === 'SCOREBUG_VISIBILITY') {
          setScorebugVisible(msg.visible);
        } else if (msg.type === 'SCOREBUG_EXPANSION') {
          setScorebugExpanded(msg.expanded, msg.athleticsRelayMode);
        } else if (msg.type === 'SCOREBUG_MATCH_NAME') {
          setScorebugMatchName(msg.name);
        } else if (msg.type === 'ATHLETICS_STANDINGS_UPDATE') {
          applyAthleticsStandings(msg.standings);
        } else if (msg.type === 'ATHLETICS_BATON_TRANSFER') {
          handleBatonTransfer(msg);
        } else if (msg.type === 'CLOCK_UPDATE') {
          if (msg.clock) {
            applyClock(msg.clock);
          }
        } else if (msg.type === 'SETS_UPDATE') {
          if (msg.sets) applySets(msg.sets);
        } else if (msg.type === 'OFFENSE_UPDATE') {
          if (msg.offense) applyOffense(msg.offense);
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
    athleticsPanel.classList.toggle('faded-out', !visible);
  }

  function setScorebugExpanded(expanded, relayMode = athleticsRelayMode) {
    athleticsExpanded = expanded === true;
    if (['compact', 'expanded', 'team'].includes(relayMode)) athleticsRelayMode = relayMode;
    scorebug.classList.toggle('expanded', expanded === true);
    athleticsPanel.classList.toggle('expanded', expanded === true);
    if (latestAthleticsStandings) applyAthleticsStandings(latestAthleticsStandings);
  }

  function setScorebugMatchName(name) {
    matchNameEl.textContent = name || '';
  }

  function applyAthleticsStandings(standings) {
    latestAthleticsStandings = standings;
    const event = standings?.event;
    const active = standings?.active === true;
    const eventLive = active && !!event && (standings?.displayMode === 'after' || event.liveStandings !== false);
    const isAfter = standings?.displayMode === 'after';
    scorebug.classList.toggle('hidden', !!active);
    athleticsPanel.classList.toggle('hidden', !eventLive);
    athleticsPanel.classList.toggle('after-results', isAfter);
    athleticsPanel.classList.toggle('roster-only', event?.resultRequired === false);
    if (!active) {
      clearRelayTickerStates(new Set());
      return;
    }

    const eventLabel = event?.name || (event?.resultRequired === false ? 'RACE ORDER' : 'EVENT STANDINGS');
    athleticsCompetitionEl.textContent = `${isAfter ? 'AFTER' : 'LIVE'} · ${event?.category === 'relay' ? 'BATON RELAY' : 'EVENT STANDINGS'}`;
    athleticsEventEl.textContent = standings?.competition || eventLabel;
    const previousTops = new Map([...athleticsResultsEl.querySelectorAll('.athletics-result[data-result-id]')]
      .map(row => [row.dataset.resultId, row.getBoundingClientRect().top]));
    athleticsResultsEl.replaceChildren();
    const houses = new Map((standings.houses || []).map(house => [house.name, house]));
    const results = [...(event?.results || [])].sort((a, b) => a.place - b.place);
    if (event?.id !== athleticsRankEventId) {
      athleticsRankEventId = event?.id || null;
      athleticsPreviousPlaces = new Map();
    }
    const nextPlaces = new Map();
    const activeRelayIds = new Set();
    results.forEach(result => nextPlaces.set(result.id, result.place));
    // Compact mode changes spacing, not the amount of the live race shown.
    results.forEach(result => {
      const row = document.createElement('div');
      row.className = 'athletics-result';
      row.dataset.resultId = result.id;
      const oldPlace = athleticsPreviousPlaces.get(result.id);
      const movement = oldPlace === undefined || oldPlace === result.place ? '' : result.place < oldPlace ? 'up' : 'down';
      if (movement) row.classList.add(`rank-moved-${movement}`);
      const place = document.createElement('span');
      place.className = 'athletics-place';
      place.textContent = String(result.place);
      if (movement) {
        place.dataset.movement = movement;
        place.title = movement === 'up' ? 'Moved up' : 'Moved down';
        setTimeout(() => {
          delete place.dataset.movement;
          row.classList.remove(`rank-moved-${movement}`);
        }, 1000);
      }
      row.appendChild(place);

      const house = houses.get(result.team);
      const mark = document.createElement('span');
      mark.className = 'athletics-team-color';
      mark.classList.toggle('has-logo', !!house?.logo);
      mark.style.backgroundColor = house?.color || '#64748b';
      mark.title = `${result.team || 'Team'} color`;
      row.appendChild(mark);
      if (house?.logo) {
        const logo = document.createElement('img');
        logo.className = 'athletics-house-logo';
        logo.src = house.logo;
        logo.alt = '';
        logo.title = house.name || result.team;
        row.appendChild(logo);
      }

      const athlete = document.createElement('div');
      athlete.className = 'athletics-athlete';
      const runners = Array.isArray(result.runnerNames) ? result.runnerNames : [];
      const athleteCodes = event?.athleteShortCodes?.[house?.id] || {};
      const codeFor = name => athleticsExpanded ? name : athleteCodes[name] || athleteCodeFallback(name);
      if (event?.category === 'relay' && runners.length) {
        activeRelayIds.add(result.id);
        renderRelayDisplay(athlete, result.id, runners, name => athleteCodes[name] || athleteCodeFallback(name), athleticsRelayMode);
      } else if (runners.length) {
        athlete.textContent = runners.map(codeFor).join(' · ');
        athlete.title = runners.join(' → ');
      } else {
        athlete.textContent = codeFor(result.athleteName);
        athlete.title = result.athleteName || '';
      }
      row.appendChild(athlete);
      const value = document.createElement('span');
      if (event?.resultRequired !== false) {
        value.className = 'athletics-result-value';
        value.textContent = result.result;
        row.appendChild(value);
      }
      athleticsResultsEl.appendChild(row);
    });
    clearRelayTickerStates(activeRelayIds);
    athleticsPreviousPlaces = nextPlaces;
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'athletics-empty';
      empty.textContent = event ? 'AWAITING EVENT RESULTS' : 'SELECT AN EVENT IN ATHLETICS CONTROL';
      athleticsResultsEl.appendChild(empty);
    }
    athleticsResultsEl.querySelectorAll('.athletics-result[data-result-id]').forEach(row => {
      const oldTop = previousTops.get(row.dataset.resultId);
      if (oldTop === undefined) return;
      const offset = oldTop - row.getBoundingClientRect().top;
      if (Math.abs(offset) > 1) row.animate(
        [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
        { duration: 420, easing: 'cubic-bezier(.2,.75,.25,1)' }
      );
    });
  }

  function renderRelayDisplay(athlete, resultId, runners, codeFor, mode) {
    let state = relayTickerStates.get(resultId);
    if (!state || state.runners.join('\u0000') !== runners.join('\u0000')) {
      state = { index: relayRunnerIndexes[resultId] || 0, runners: [...runners], transferId: 0 };
      relayTickerStates.set(resultId, state);
    }
    state.runners = [...runners];
    state.index = ((relayRunnerIndexes[resultId] ?? state.index) % runners.length + runners.length) % runners.length;
    state.codeFor = codeFor;
    state.mode = mode;
    athlete.classList.add(`athletics-relay-${mode}`);
    athlete.replaceChildren();
    state.runnerEls = [];
    if (mode === 'team') {
      runners.forEach((name, index) => {
        const runnerEl = document.createElement('span');
        runnerEl.className = 'athletics-runner athletics-relay-team-runner';
        runnerEl.textContent = name;
        runnerEl.title = name;
        runnerEl.classList.toggle('current', index === state.index);
        state.runnerEls.push(runnerEl);
        athlete.appendChild(runnerEl);
      });
    } else {
      const runner = document.createElement('span');
      runner.className = 'athletics-relay-current';
      const shownRunner = runners[state.index];
      runner.textContent = mode === 'compact' ? codeFor(shownRunner) : shownRunner;
      runner.title = shownRunner;
      state.runnerEls.push(runner);
      athlete.appendChild(runner);
    }
  }

  function handleBatonTransfer(message) {
    if (message.eventId !== latestAthleticsStandings?.event?.id) return;
    const state = relayTickerStates.get(message.resultId);
    if (!state || !state.runnerEls?.length) return;
    const targetIndex = Number(message.runnerIndex);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= state.runners.length) return;
    const previousIndex = state.index;
    const outgoing = state.runnerEls[state.mode === 'team' ? previousIndex : 0];
    if (!outgoing?.isConnected) return;
    state.arrowEl?.remove();
    const arrow = document.createElement('span');
    arrow.className = 'athletics-relay-transfer passing';
    arrow.setAttribute('aria-label', `Baton transferred to ${state.runners[targetIndex]}`);
    arrow.appendChild(document.createTextNode('➜ '));
    const incomingName = document.createElement('strong');
    incomingName.className = 'athletics-relay-incoming';
    incomingName.textContent = state.mode === 'compact' ? state.codeFor(state.runners[targetIndex]) : state.runners[targetIndex];
    arrow.appendChild(incomingName);
    const resultRow = outgoing.closest('.athletics-result') || athlete;
    resultRow.appendChild(arrow);
    state.arrowEl = arrow;
    outgoing.classList.add('passing-out');
    const transferId = ++state.transferId;
    setTimeout(() => {
      if (state.transferId !== transferId) return;
      relayRunnerIndexes[message.resultId] = targetIndex;
      state.index = targetIndex;
      if (latestAthleticsStandings) applyAthleticsStandings(latestAthleticsStandings);
      const arriving = state.mode === 'team' ? state.runnerEls[targetIndex] : state.runnerEls[0];
      arriving?.animate?.(
        [{ opacity: 0.15, transform: 'translateX(24px)' }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 420, easing: 'cubic-bezier(.2,.75,.25,1)' }
      );
      setTimeout(() => arrow.remove(), 260);
    }, 620);
  }

  function clearRelayTickerStates(activeIds) {
    for (const resultId of relayTickerStates.keys()) {
      if (!activeIds.has(resultId)) relayTickerStates.delete(resultId);
    }
  }

  function athleteCodeFallback(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts.map(part => part[0]).join('') : (parts[0] || '').slice(0, 3))
      .replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'ATH';
  }

  connectWebSocket();
})();
