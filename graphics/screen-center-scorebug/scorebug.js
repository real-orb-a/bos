(function() {
  const homeScoreEl = document.getElementById('home-score');
  const awayScoreEl = document.getElementById('away-score');
  const homeShortEl = document.getElementById('home-short');
  const awayShortEl = document.getElementById('away-short');
  const homeNameEl = document.getElementById('home-name');
  const awayNameEl = document.getElementById('away-name');
  const homeLogoEl = document.getElementById('home-logo');
  const awayLogoEl = document.getElementById('away-logo');
  const homeHouseSubtitleEl = document.getElementById('home-house-subtitle');
  const awayHouseSubtitleEl = document.getElementById('away-house-subtitle');
  const scorebug = document.getElementById('score-bug');
  const matchNameEl = document.getElementById('match-name');
  const clockEl = document.getElementById('clock-display');
  const periodEl = document.getElementById('period-display');
  const offenseBannerEl = document.getElementById('offense-banner');
  const offenseClockEl = document.getElementById('offense-clock-display');
  const periodBannerEl = document.getElementById('period-banner');
  const athleticsPanel = document.getElementById('athletics-standings');
  const athleticsCompetitionEl = document.getElementById('athletics-competition');
  const athleticsEventEl = document.getElementById('athletics-event-title');
  const athleticsResultsEl = document.getElementById('athletics-result-list');

  let currentHomeScore = 0;
  let currentAwayScore = 0;
  let currentTimerMode = null;
  let athleticsActive = false;
  let athleticsEventSelected = false;
  let centerVisible = false;
  let sportScorebug = null;
  let athleticsExpanded = false;
  let athleticsRelayMode = 'compact';
  let athleticsRankEventId = null;
  let athleticsPreviousPlaces = new Map();
  let latestAthleticsStandings = null;
  const relayTickerStates = new Map();
  let relayRunnerIndexes = {};
  const teamData = { home: null, away: null };

  const garnetBrand = { short: 'GAR', name: 'GARNET', logo: '../score/assets/houses/garnet.png' };
  const emeraldBrand = { short: 'EME', name: 'EMERALD', logo: '../score/assets/houses/emerald.png' };
  const topazBrand = { short: 'TOP', name: 'TOPAZ', logo: '../score/assets/houses/topaz.png' };
  const houseBrands = {
    GARNET: garnetBrand, GAR: garnetBrand,
    EMERALD: emeraldBrand, EME: emeraldBrand,
    TOPAZ: topazBrand, TOP: topazBrand
  };

  function resolveHouseBrand(name) {
    const normalized = String(name || '').trim().toUpperCase()
      .replace(/\s+HOUSE$/, '')
      .replace(/\s+/g, ' ');
    return houseBrands[normalized] || null;
  }

  function displayText(value, fallback = '') {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && typeof value === 'object') {
      for (const key of ['name', 'shortName', 'short', 'label', 'value']) {
        if (value[key] !== undefined && value[key] !== value) {
          const text = displayText(value[key]);
          if (text) return text;
        }
      }
    }
    return fallback;
  }

  function playerShortCode(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0].toUpperCase().slice(0, 6);
    return parts.map((part, index) => index === parts.length - 1
      ? part.toUpperCase()
      : `${part[0].toUpperCase()}.`).join(' ');
  }

  function racketPlayerName(player) {
    return displayText(player, '');
  }

  function racketPlayerCode(player) {
    if (player && typeof player === 'object' && player.shortCode) {
      return displayText(player.shortCode).trim().slice(0, 3).toUpperCase();
    }
    return playerShortCode(racketPlayerName(player)).replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase();
  }

  function setIdentity(elShort, elName, elLogo, data, isHome) {
    data = data && typeof data === 'object' ? data : { name: data };
    const side = isHome ? 'home' : 'away';
    const fallbackShort = isHome ? 'GAR' : 'TOP';
    const fallbackName = isHome ? 'GARNET' : 'TOPAZ';
    const fallbackLogo = isHome ? garnetBrand.logo : topazBrand.logo;
    const houseName = displayText(data.name, fallbackName);
    const rawShort = displayText(data.short, displayText(isHome ? sportScorebug?.homeShort : sportScorebug?.awayShort));
    const brand = resolveHouseBrand(houseName) || resolveHouseBrand(rawShort) || null;
    const houseShort = rawShort || brand?.short || fallbackShort;
    teamData[side] = { ...data, name: houseName, short: houseShort };
    const rawPlayerNames = sportScorebug?.mode && ['table-tennis', 'badminton'].includes(sportScorebug.mode)
      ? (isHome ? sportScorebug.homePlayers : sportScorebug.awayPlayers) : [];
    const playerNames = Array.isArray(rawPlayerNames) ? rawPlayerNames : [];
    const subtitle = isHome ? homeHouseSubtitleEl : awayHouseSubtitleEl;
    elShort.replaceChildren();
    if (playerNames.length) {
      playerNames.forEach(player => {
        const badge = document.createElement('span');
        badge.className = 'player-shortcode-badge';
        badge.textContent = racketPlayerCode(player);
        elShort.appendChild(badge);
      });
    } else {
      elShort.textContent = brand?.short || houseShort;
    }
    elName.textContent = playerNames.length
      ? playerNames.map(racketPlayerName).join('   ·   ')
      : (brand?.name || houseName);
    if (['table-tennis', 'badminton'].includes(sportScorebug?.mode)) {
      subtitle.textContent = `${houseName} (${houseShort})`;
      subtitle.classList.remove('hidden');
    } else {
      subtitle.classList.add('hidden');
    }
    const logo = displayText(data.logo, '') || brand?.logo || fallbackLogo;
    if (logo) {
      elLogo.src = logo;
      elLogo.classList.add('has-logo');
    } else {
      elLogo.removeAttribute('src');
      elLogo.classList.remove('has-logo');
    }
    elLogo.alt = `${brand?.name || houseName} logo`;
  }

  function applySportScorebug(state) {
    sportScorebug = state && typeof state === 'object' ? state : null;
    const mode = sportScorebug?.mode;
    const racketMode = ['table-tennis', 'badminton'].includes(mode);
    scorebug.classList.toggle('racket-mode', racketMode);
    scorebug.classList.toggle('games-mode', ['games', 'badminton'].includes(mode));
    scorebug.classList.toggle('volleyball-mode', mode === 'volleyball');
    scorebug.classList.toggle('cricket-mode', mode === 'cricket');
    if (teamData.home) setIdentity(homeShortEl, homeNameEl, homeLogoEl, teamData.home, true);
    if (teamData.away) setIdentity(awayShortEl, awayNameEl, awayLogoEl, teamData.away, false);
    const sets = document.getElementById('sets-display');
    const setsValue = document.getElementById('sets-value');
    const setsLabel = document.getElementById('sets-label');
    const showSets = ['volleyball', 'table-tennis', 'badminton', 'games'].includes(mode);
    sets.classList.toggle('hidden', !showSets);
    if (showSets) {
      setsValue.textContent = `${displayText(sportScorebug.homeSets, '0')}–${displayText(sportScorebug.awaySets, '0')}`;
      setsLabel.textContent = ['badminton', 'games'].includes(mode) ? 'GAMES' : 'SETS';
    }
  }

  function triggerAnimation(el, animType) {
    const cls = animType === 'flip' ? 'score-flip' : 'score-pop';
    el.classList.remove('score-pop', 'score-flip');
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function applyClock(clock) {
    if (!clock || typeof clock !== 'object') return;
    currentTimerMode = displayText(clock.mode, currentTimerMode);
    clockEl.textContent = displayText(clock.formatted, '00:00');
    if (clock.period !== undefined) periodEl.textContent = displayText(clock.period, '');
    applyOffense(clock.offense || clock.offenseTimer);
  }

  function applyOffense(offense) {
    if (!offense || typeof offense !== 'object') offense = {};
    const active = currentTimerMode === 'countdown' && offense.enabled === true && offense.active !== false;
    offenseClockEl.textContent = displayText(offense.seconds ?? offense.elapsedSeconds, '0');
    offenseBannerEl.classList.toggle('hidden', !active);
    scorebug.classList.toggle('offense-active', active);
    periodEl.classList.toggle('hidden', active);
    if (active) periodBannerEl.textContent = displayText(periodEl.textContent, '1ST');
  }

  function updateDisplay(data, anim = 'pop', changedTeam = null) {
    if (!data) return;
    if ('sportScorebug' in data) applySportScorebug(data.sportScorebug);
    if (data.home) {
      setIdentity(homeShortEl, homeNameEl, homeLogoEl, data.home, true);
      const homeScore = Number(displayText(data.home.score, String(currentHomeScore)));
      const newHome = Number.isFinite(homeScore) ? homeScore : currentHomeScore;
      if (newHome !== currentHomeScore || changedTeam === 'home' || changedTeam === 'both') {
        currentHomeScore = newHome;
        homeScoreEl.textContent = displayText(currentHomeScore, '0');
        triggerAnimation(homeScoreEl, anim);
      }
    }
    if (data.away) {
      setIdentity(awayShortEl, awayNameEl, awayLogoEl, data.away, false);
      const awayScore = Number(displayText(data.away.score, String(currentAwayScore)));
      const newAway = Number.isFinite(awayScore) ? awayScore : currentAwayScore;
      if (newAway !== currentAwayScore || changedTeam === 'away' || changedTeam === 'both') {
        currentAwayScore = newAway;
        awayScoreEl.textContent = displayText(currentAwayScore, '0');
        triggerAnimation(awayScoreEl, anim);
      }
    }
    if (data.clock) {
      applyClock(data.clock);
    }
  }

  function setCenterVisible(visible) {
    centerVisible = !!visible;
    scorebug.classList.toggle('center-visible', centerVisible);
    athleticsPanel.classList.toggle('hidden', !athleticsActive || !athleticsEventSelected || !centerVisible);
  }

  function setMatchName(name) {
    matchNameEl.textContent = displayText(name, '');
  }

  function setExpanded(expanded, relayMode = athleticsRelayMode) {
    athleticsExpanded = !!expanded;
    if (['compact', 'expanded', 'team'].includes(relayMode)) athleticsRelayMode = relayMode;
    scorebug.classList.toggle('expanded', !!expanded);
    athleticsPanel.classList.toggle('expanded', !!expanded);
    if (latestAthleticsStandings) applyAthleticsStandings(latestAthleticsStandings);
  }

  function applyAthleticsStandings(standings) {
    latestAthleticsStandings = standings;
    const event = standings?.event;
    athleticsActive = standings?.active === true;
    const hasEvent = athleticsActive && !!event && (standings?.displayMode === 'after' || event.liveStandings !== false);
    athleticsEventSelected = hasEvent;
    const after = standings?.displayMode === 'after';
    scorebug.classList.toggle('athletics-active', athleticsActive);
    athleticsPanel.classList.toggle('hidden', !hasEvent || !centerVisible);
    athleticsPanel.classList.toggle('center-athletics', hasEvent);
    athleticsPanel.classList.toggle('after-results', after);
    athleticsPanel.classList.toggle('roster-only', event?.resultRequired === false);
    if (!athleticsActive) {
      clearRelayTickerStates(new Set());
      return;
    }
    const eventLabel = event?.name || (event?.resultRequired === false ? 'RACE ORDER' : 'EVENT STANDINGS');
    athleticsCompetitionEl.textContent = `${after ? 'AFTER' : 'LIVE'} · ${event?.category === 'relay' ? 'BATON RELAY' : 'EVENT STANDINGS'}`;
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
    results.forEach(result => {
      const row = document.createElement('div');
      row.className = 'athletics-result';
      row.dataset.resultId = result.id;
      const oldPlace = athleticsPreviousPlaces.get(result.id);
      const movement = oldPlace === undefined || oldPlace === result.place ? '' : result.place < oldPlace ? 'up' : 'down';
      if (movement) row.classList.add(`rank-moved-${movement}`);
      const place = document.createElement('span');
      place.className = 'athletics-place'; place.textContent = String(result.place);
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
      const swatch = document.createElement('span'); swatch.className = 'athletics-team-color'; swatch.classList.toggle('has-logo', !!house?.logo); swatch.style.backgroundColor = house?.color || '#64748b'; swatch.title = `${result.team || 'Team'} color`; row.appendChild(swatch);
      if (house?.logo) { const logo = document.createElement('img'); logo.className = 'athletics-house-logo'; logo.src = house.logo; logo.alt = ''; logo.title = house.name || result.team; row.appendChild(logo); }
      const athlete = document.createElement('div'); athlete.className = 'athletics-athlete';
      const codes = event?.athleteShortCodes?.[house?.id] || {};
      const codeFor = name => athleticsExpanded ? name : codes[name] || athleteCodeFallback(name);
      const runners = result.runnerNames || [];
      if (event?.category === 'relay' && runners.length) activeRelayIds.add(result.id);
      if (event?.category === 'relay' && runners.length) {
        renderRelayDisplay(athlete, result.id, runners, name => codes[name] || athleteCodeFallback(name), athleticsRelayMode);
      } else if (runners.length) {
        athlete.textContent = runners.map(codeFor).join(' · ');
      } else {
        athlete.textContent = codeFor(result.athleteName);
      }
      row.appendChild(athlete);
      athlete.title = runners.join(' → ') || result.athleteName || '';
      if (event?.resultRequired !== false) {
        const value = document.createElement('span'); value.className = 'athletics-result-value'; value.textContent = result.result || '—'; row.appendChild(value);
      }
      athleticsResultsEl.appendChild(row);
    });
    clearRelayTickerStates(activeRelayIds);
    athleticsPreviousPlaces = nextPlaces;
    if (!results.length) {
      const empty = document.createElement('div'); empty.className = 'athletics-empty';
      empty.textContent = hasEvent ? 'AWAITING EVENT RESULTS' : 'SELECT AN EVENT IN ATHLETICS CONTROL';
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

  function connectWebSocket() {
    const wsUrl = `ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INITIAL_SYNC') {
          if (msg.score) updateDisplay(msg.score, 'none');
          if (msg.offense) applyOffense(msg.offense);
          setCenterVisible(msg.screenCenterScorebugVisible === true);
          setExpanded(msg.scorebugExpanded === true, msg.athleticsRelayMode);
          setMatchName(msg.scorebugMatchName || '');
          applySportScorebug(msg.sportScorebug);
          relayRunnerIndexes = { ...(msg.athleticsRelayRunnerIndexes || {}) };
          applyAthleticsStandings(msg.athleticsStandings);
        } else if (msg.type === 'SCORE_UPDATE') {
          updateDisplay(msg, msg.animation || 'pop', msg.changedTeam);
        } else if (msg.type === 'SPORT_SCOREBUG_UPDATE') {
          applySportScorebug(msg.sportScorebug);
        } else if (msg.type === 'SCREEN_CENTER_SCOREBUG_VISIBILITY') {
          setCenterVisible(msg.visible);
        } else if (msg.type === 'SCOREBUG_MATCH_NAME') {
          setMatchName(msg.name);
        } else if (msg.type === 'SCOREBUG_EXPANSION') {
          setExpanded(msg.expanded, msg.athleticsRelayMode);
        } else if (msg.type === 'ATHLETICS_STANDINGS_UPDATE') {
          applyAthleticsStandings(msg.standings);
        } else if (msg.type === 'ATHLETICS_BATON_TRANSFER') {
          handleBatonTransfer(msg);
        } else if (msg.type === 'CLOCK_UPDATE') {
          if (msg.clock) applyClock(msg.clock);
        } else if (msg.type === 'SETS_UPDATE') {
          const setsEl = document.getElementById('sets-value');
          if (setsEl && msg.sets) {
            setsEl.textContent = msg.sets;
            setsEl.classList.remove('hidden');
          }
        } else if (msg.type === 'OFFENSE_UPDATE') {
          applyOffense(msg.offense);
        }
      } catch (err) {
        console.error('[ScreenCenterScorebug] Message error:', err);
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 2000);
    };
  }

  connectWebSocket();
})();
