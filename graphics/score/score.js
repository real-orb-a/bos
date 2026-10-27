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
  const homeTennisTeamEl = document.getElementById('home-tennis-team');
  const awayTennisTeamEl = document.getElementById('away-tennis-team');
  const athleticsPanel = document.getElementById('athletics-standings');
  const athleticsCompetitionEl = document.getElementById('athletics-competition');
  const athleticsEventEl = document.getElementById('athletics-event-title');
  const athleticsResultsEl = document.getElementById('athletics-result-list');
  const athleticsPodiumEl = document.getElementById('athletics-podium');
  const athleticsPodiumCompetitionEl = document.getElementById('athletics-podium-competition');
  const athleticsPodiumEventEl = document.getElementById('athletics-podium-event');
  const athleticsPodiumPlacesEl = document.getElementById('athletics-podium-places');

  let currentHomeScore = 0;
  let currentAwayScore = 0;
  let currentTimerMode = null;
  let sportScorebug = null;
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

  function tableTennisPlayers(side) {
    if (sportScorebug?.mode !== 'table-tennis') return [];
    const names = side === 'home' ? sportScorebug.homePlayers : sportScorebug.awayPlayers;
    return Array.isArray(names) ? names : [];
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
    const playerNames = tableTennisPlayers(side);
    const isTableTennis = sportScorebug?.mode === 'table-tennis';
    const tennisTeamEl = isHome ? homeTennisTeamEl : awayTennisTeamEl;
    if (isTableTennis) {
      // Compact view: player short code. Expanded view: full player name + team name below.
      shortEl.textContent = playerNames.map(playerShortCode).join(' + ') || fallbackShort;
      nameEl.textContent = playerNames.join(' + ') || name;
      tennisTeamEl.textContent = name;
      tennisTeamEl.classList.remove('hidden');
    } else {
      shortEl.textContent = brand?.short || data.short || fallbackShort;
      nameEl.textContent = brand?.name || name;
      tennisTeamEl.classList.add('hidden');
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
    scorebug.classList.toggle('games-mode', sportScorebug?.mode === 'games');
    scorebug.classList.toggle('table-tennis-mode', sportScorebug?.mode === 'table-tennis');
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
    } else if (sportScorebug?.mode === 'games') {
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
          setScorebugExpanded(msg.scorebugExpanded === true);
          setScorebugMatchName(msg.scorebugMatchName || '');
          applySportScorebug(msg.sportScorebug);
          applyAthleticsStandings(msg.athleticsStandings);
        } else if (msg.type === 'SCORE_UPDATE') {
          updateDisplay(msg, msg.animation || 'pop', msg.changedTeam);
        } else if (msg.type === 'SPORT_SCOREBUG_UPDATE') {
          applySportScorebug(msg.sportScorebug);
        } else if (msg.type === 'SCOREBUG_VISIBILITY') {
          setScorebugVisible(msg.visible);
        } else if (msg.type === 'SCOREBUG_EXPANSION') {
          setScorebugExpanded(msg.expanded);
        } else if (msg.type === 'SCOREBUG_MATCH_NAME') {
          setScorebugMatchName(msg.name);
        } else if (msg.type === 'ATHLETICS_STANDINGS_UPDATE') {
          applyAthleticsStandings(msg.standings);
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
  }

  function setScorebugExpanded(expanded) {
    scorebug.classList.toggle('expanded', expanded === true);
    athleticsPanel.classList.toggle('expanded', expanded === true);
  }

  function setScorebugMatchName(name) {
    matchNameEl.textContent = name || '';
  }

  function applyAthleticsStandings(standings) {
    const event = standings?.event;
    const active = standings?.active === true;
    const podiumVisible = standings?.podiumVisible === true && !!event?.results?.length;
    scorebug.classList.toggle('hidden', !!active);
    athleticsPanel.classList.toggle('hidden', !active || podiumVisible);
    athleticsPodiumEl.classList.toggle('hidden', !active || !podiumVisible);
    if (!active) return;

    athleticsCompetitionEl.textContent = standings.competition || 'ATHLETICS';
    athleticsEventEl.textContent = event?.name || 'AWAITING EVENT';
    athleticsPodiumCompetitionEl.textContent = standings.competition || 'ATHLETICS';
    athleticsPodiumEventEl.textContent = event?.name || '';
    athleticsResultsEl.replaceChildren();
    const houses = new Map((standings.houses || []).map(house => [house.name, house]));
    const results = [...(event?.results || [])].sort((a, b) => a.place - b.place);
    results.slice(0, 8).forEach(result => {
      const row = document.createElement('div');
      row.className = 'athletics-result';
      const place = document.createElement('span');
      place.className = 'athletics-place';
      place.textContent = String(result.place);
      row.appendChild(place);

      const house = houses.get(result.team);
      if (house?.logo) {
        const logo = document.createElement('img');
        logo.className = 'athletics-house-logo';
        logo.src = house.logo;
        logo.alt = `${house.name} logo`;
        row.appendChild(logo);
      } else if (resolveHouseBrand(house?.name || result.team)) {
        const logo = document.createElement('img');
        logo.className = 'athletics-house-logo';
        logo.src = resolveHouseBrand(house?.name || result.team).logo;
        logo.alt = `${house?.name || result.team} logo`;
        row.appendChild(logo);
      } else {
        const mark = document.createElement('span');
        mark.className = 'athletics-house-logo fallback';
        mark.textContent = house?.name?.slice(0, 1).toUpperCase() || '?';
        mark.style.backgroundColor = house?.color || '#64748b';
        row.appendChild(mark);
      }

      const athlete = document.createElement('div');
      athlete.className = 'athletics-athlete';
      const runners = Array.isArray(result.runnerNames) ? result.runnerNames : [];
      if (runners.length) {
        runners.forEach((runner, index) => {
          if (index > 0) {
            const handoff = document.createElement('span');
            handoff.className = 'athletics-handoff';
            handoff.textContent = '›';
            athlete.appendChild(handoff);
          }
          const runnerName = document.createElement('span');
          runnerName.className = 'athletics-runner';
          runnerName.textContent = runner;
          athlete.appendChild(runnerName);
        });
      } else {
        athlete.textContent = result.athleteName;
      }
      row.appendChild(athlete);
      const houseName = document.createElement('span');
      houseName.className = 'athletics-house-name';
      houseName.textContent = result.team;
      row.appendChild(houseName);
      const value = document.createElement('span');
      value.className = 'athletics-result-value';
      value.textContent = result.result;
      row.appendChild(value);
      athleticsResultsEl.appendChild(row);
    });
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'athletics-empty';
      empty.textContent = event ? 'AWAITING EVENT RESULTS' : 'SELECT AN EVENT IN ATHLETICS CONTROL';
      athleticsResultsEl.appendChild(empty);
    } else if (results.length > 8) {
      const more = document.createElement('div');
      more.className = 'athletics-empty';
      more.textContent = `${results.length - 8} MORE RESULTS`;
      athleticsResultsEl.appendChild(more);
    }
    athleticsPodiumPlacesEl.replaceChildren();
    const podiumResults = [2, 1, 3].map(place => results.find(result => result.place === place));
    podiumResults.forEach((result, index) => {
      const placeNumber = [2, 1, 3][index];
      const house = result ? houses.get(result.team) : null;
      const step = document.createElement('article');
      step.className = `podium-step podium-place-${placeNumber}`;
      step.style.setProperty('--house-color', house?.color || '#475569');
      const houseLogo = house?.logo || resolveHouseBrand(house?.name)?.logo;
      if (houseLogo) step.style.setProperty('--house-logo', `url("${houseLogo}")`);
      const identity = document.createElement('div');
      identity.className = 'podium-identity';
      if (result) {
        const runner = document.createElement('strong');
        runner.textContent = (result.runnerNames || []).join(' › ') || result.athleteName;
        const team = document.createElement('span');
        team.textContent = result.team;
        identity.append(runner, team);
      } else {
        const awaiting = document.createElement('strong');
        awaiting.textContent = 'AWAITING RESULT';
        identity.appendChild(awaiting);
      }
      const place = document.createElement('b');
      place.textContent = String(placeNumber);
      step.append(identity, place);
      athleticsPodiumPlacesEl.appendChild(step);
    });
  }

  connectWebSocket();
})();
