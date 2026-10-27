(function() {
  const homeScoreEl = document.getElementById('home-score');
  const awayScoreEl = document.getElementById('away-score');
  const homeShortEl = document.getElementById('home-short');
  const awayShortEl = document.getElementById('away-short');
  const homeNameEl = document.getElementById('home-name');
  const awayNameEl = document.getElementById('away-name');
  const homeLogoEl = document.getElementById('home-logo');
  const awayLogoEl = document.getElementById('away-logo');
  const scorebug = document.getElementById('score-bug');
  const matchNameEl = document.getElementById('match-name');
  const clockEl = document.getElementById('clock-display');
  const periodEl = document.getElementById('period-display');

  let currentHomeScore = 0;
  let currentAwayScore = 0;

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

  function setIdentity(elShort, elName, elLogo, data, isHome) {
    const fallbackShort = isHome ? 'GAR' : 'TOP';
    const fallbackName = isHome ? 'GARNET' : 'TOPAZ';
    const fallbackLogo = isHome ? garnetBrand.logo : topazBrand.logo;
    const brand = resolveHouseBrand(data.name) || resolveHouseBrand(data.short) || null;
    elShort.textContent = brand?.short || data.short || fallbackShort;
    elName.textContent = brand?.name || data.name || fallbackName;
    const logo = data.logo || brand?.logo || fallbackLogo;
    if (logo) {
      elLogo.src = logo;
      elLogo.classList.add('has-logo');
    } else {
      elLogo.removeAttribute('src');
      elLogo.classList.remove('has-logo');
    }
    elLogo.alt = `${brand?.name || data.name || fallbackName} logo`;
  }

  function triggerAnimation(el, animType) {
    const cls = animType === 'flip' ? 'score-flip' : 'score-pop';
    el.classList.remove('score-pop', 'score-flip');
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function updateDisplay(data, anim = 'pop', changedTeam = null) {
    if (!data) return;
    if (data.home) {
      setIdentity(homeShortEl, homeNameEl, homeLogoEl, data.home, true);
      const newHome = data.home.score !== undefined ? data.home.score : currentHomeScore;
      if (newHome !== currentHomeScore || changedTeam === 'home' || changedTeam === 'both') {
        currentHomeScore = newHome;
        homeScoreEl.textContent = currentHomeScore;
        triggerAnimation(homeScoreEl, anim);
      }
    }
    if (data.away) {
      setIdentity(awayShortEl, awayNameEl, awayLogoEl, data.away, false);
      const newAway = data.away.score !== undefined ? data.away.score : currentAwayScore;
      if (newAway !== currentAwayScore || changedTeam === 'away' || changedTeam === 'both') {
        currentAwayScore = newAway;
        awayScoreEl.textContent = currentAwayScore;
        triggerAnimation(awayScoreEl, anim);
      }
    }
    if (data.clock) {
      clockEl.textContent = data.clock.formatted || '00:00';
      if (data.clock.period) periodEl.textContent = data.clock.period.toUpperCase();
    }
  }

  function setCenterVisible(visible) {
    scorebug.classList.toggle('center-visible', !!visible);
  }

  function setMatchName(name) {
    matchNameEl.textContent = name || '';
  }

  function setExpanded(expanded) {
    scorebug.classList.toggle('expanded', !!expanded);
  }

  function connectWebSocket() {
    const wsUrl = `ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INITIAL_SYNC') {
          if (msg.score) updateDisplay(msg.score, 'none');
          setCenterVisible(msg.screenCenterScorebugVisible === true);
          setExpanded(msg.scorebugExpanded === true);
          setMatchName(msg.scorebugMatchName || '');
        } else if (msg.type === 'SCORE_UPDATE') {
          updateDisplay(msg, msg.animation || 'pop', msg.changedTeam);
        } else if (msg.type === 'SCREEN_CENTER_SCOREBUG_VISIBILITY') {
          setCenterVisible(msg.visible);
        } else if (msg.type === 'SCOREBUG_MATCH_NAME') {
          setMatchName(msg.name);
        } else if (msg.type === 'SCOREBUG_EXPANSION') {
          setExpanded(msg.expanded);
        } else if (msg.type === 'CLOCK_UPDATE') {
          if (msg.clock) {
            clockEl.textContent = msg.clock.formatted || '00:00';
            if (msg.clock.period) periodEl.textContent = msg.clock.period.toUpperCase();
          }
        } else if (msg.type === 'SETS_UPDATE') {
          const setsEl = document.getElementById('sets-value');
          if (setsEl && msg.sets) {
            setsEl.textContent = msg.sets;
            setsEl.classList.remove('hidden');
          }
        } else if (msg.type === 'OFFENSE_UPDATE') {
          const offenseBannerEl = document.getElementById('offense-banner');
          const offenseClockEl = document.getElementById('offense-clock-display');
          const periodBannerEl = document.getElementById('period-banner');
          if (offenseBannerEl && offenseClockEl) {
            offenseClockEl.textContent = msg.offense || '00';
            offenseBannerEl.classList.toggle('hidden', !msg.offense);
            if (msg.offense) {
              scorebug.classList.add('offense-active');
              if (periodBannerEl) periodBannerEl.textContent = (periodEl.textContent || '1ST').toUpperCase();
            } else {
              scorebug.classList.remove('offense-active');
            }
          }
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
