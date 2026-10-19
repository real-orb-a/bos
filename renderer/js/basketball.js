window.BasketballModule = (() => {
  const byId = (id) => document.getElementById(id);
  let state = null;
  let initialized = false;
  let busy = false;

  function feedback(message, error = false, setup = false) {
    const node = byId(setup ? 'basketball-setup-feedback' : 'basketball-control-feedback');
    node.textContent = message || '';
    node.classList.toggle('error', error);
  }

  function showView(view, focus) {
    window.BOSNavigation.showView(view, focus);
  }

  async function act(action) {
    if (busy) return;
    busy = true;
    render(state);
    try {
      render(await action());
      feedback('Saved.');
    } catch (error) {
      feedback(error.message || 'Basketball action failed.', true);
    } finally {
      busy = false;
      render(state);
    }
  }

  function readSetup() {
    const setup = {
      competitionName: byId('basketball-competition').value.trim(),
      matchName: byId('basketball-match-name').value.trim(),
      homeTeamName: byId('basketball-home-name').value.trim(),
      awayTeamName: byId('basketball-away-name').value.trim(),
      periodCount: Number(byId('basketball-period-count').value),
      periodMinutes: Number(byId('basketball-period-minutes').value),
      shotClockSeconds: Number(byId('basketball-shot-clock').value)
    };
    if (!setup.competitionName || !setup.matchName || !setup.homeTeamName || !setup.awayTeamName) {
      throw new Error('Enter competition, match, and both team names.');
    }
    if (!Number.isInteger(setup.periodCount) || setup.periodCount < 2 || setup.periodCount > 8
      || !Number.isInteger(setup.periodMinutes) || setup.periodMinutes < 1 || setup.periodMinutes > 30
      || !Number.isInteger(setup.shotClockSeconds) || setup.shotClockSeconds < 1 || setup.shotClockSeconds > 60) {
      throw new Error('Check period count, period length, and shot-clock settings.');
    }
    return setup;
  }

  function readSeconds(id, label, max) {
    const value = byId(id).value.trim();
    const seconds = Number(value);
    if (!value || !Number.isInteger(seconds) || seconds < 0 || seconds > max) {
      throw new Error(`${label} must be a whole number from 0 to ${max}.`);
    }
    return seconds;
  }

  async function createMatch() {
    if (busy) return;
    busy = true;
    byId('btn-basketball-create-match').disabled = true;
    feedback('');
    try {
      state = await window.bosAPI.basketball.createMatch(readSetup());
      render(state);
      showView('basketballControl', '#basketball-control-title');
      feedback('Match created. Start the game clock when play begins.');
    } catch (error) {
      feedback(error.message || 'Basketball match setup failed.', true, true);
    } finally {
      busy = false;
      byId('btn-basketball-create-match').disabled = !!(state && state.storage && state.storage.writesBlocked);
      render(state);
    }
  }

  async function openFromLanding() {
    try {
      state = await window.bosAPI.basketball.getState();
      render(state);
      if (state.match) {
        showView('basketballControl', '#basketball-control-title');
      } else {
        showView('basketballSetup', '#basketball-setup-title');
      }
    } catch (error) {
      feedback(error.message || 'Basketball match state could not be loaded.', true, true);
      showView('basketballSetup', '#basketball-setup-title');
    }
  }

  function render(next) {
    if (!next) return;
    state = next;
    const match = next.match;
    const locked = !!(next.storage && next.storage.writesBlocked);
    const recovered = !!(next.storage && next.storage.recoveredFromBackup);
    byId('basketball-status').textContent = locked ? 'STORAGE RECOVERY REQUIRED'
      : recovered ? `RECOVERED · ${match ? match.status : 'NO MATCH'}` : match ? match.status : 'NO MATCH';
    if (!match) {
      byId('basketball-live-status').textContent = 'NO MATCH';
      byId('btn-basketball-new-match').classList.add('hidden');
      if (locked) {
        document.querySelectorAll('#basketball-setup-view input, #btn-basketball-create-match')
          .forEach((control) => { control.disabled = true; });
        feedback('Basketball storage is read-only. Match setup is disabled.', true, true);
      }
      return;
    }
    byId('basketball-live-competition').textContent = match.competitionName;
    byId('basketball-live-match').textContent = match.matchName;
    byId('basketball-control-title').textContent = `${match.competitionName} · ${match.matchName}`;
    byId('basketball-live-home-name').textContent = match.teams.home.name;
    byId('basketball-live-away-name').textContent = match.teams.away.name;
    byId('basketball-live-home-score').textContent = String(match.teams.home.score);
    byId('basketball-live-away-score').textContent = String(match.teams.away.score);
    byId('basketball-live-home-fouls').textContent = String(match.teams.home.fouls);
    byId('basketball-live-away-fouls').textContent = String(match.teams.away.fouls);
    byId('basketball-live-home-timeouts').textContent = String(match.teams.home.timeouts);
    byId('basketball-live-away-timeouts').textContent = String(match.teams.away.timeouts);
    byId('basketball-period-label').textContent = match.period > match.periodCount ? 'FINAL' : (match.period > 4 ? `OT${match.period - 4}` : `Q${match.period}`);
    byId('basketball-live-clock').textContent = match.clock;
    byId('basketball-live-shot').textContent = String(match.shotClock);
    byId('basketball-live-state').textContent = match.timeoutActive
      ? `${match.teams[match.timeoutActive].name} TIMEOUT`
      : match.clockRunning ? 'CLOCK RUNNING' : match.status.replace(/_/g, ' ');
    byId('btn-basketball-clock-toggle').textContent = match.clockRunning ? 'PAUSE CLOCK' : 'START CLOCK';
    byId('btn-basketball-end-timeout').classList.toggle('hidden', !match.timeoutActive);
    byId('btn-basketball-new-match').classList.toggle('hidden', match.status !== 'FINAL');
    const periodSelect = byId('basketball-period-select');
    if (periodSelect.options.length !== match.periodCount + 1) {
      periodSelect.replaceChildren();
      for (let period = 1; period <= match.periodCount; period++) {
        const option = document.createElement('option');
        option.value = String(period);
        option.textContent = period <= 4 ? `Quarter ${period}` : `Overtime ${period - 4}`;
        periodSelect.appendChild(option);
      }
    }
    periodSelect.value = String(Math.min(match.period, match.periodCount));
    document.querySelectorAll('.basketball-live-content button, .basketball-live-content input, .basketball-live-content select')
      .forEach((control) => { control.disabled = locked || busy; });
    byId('btn-basketball-new-match').disabled = locked || busy;
    if (match.timeoutActive) {
      byId('btn-basketball-clock-toggle').disabled = true;
      document.querySelectorAll('[data-points], [data-adjust], [data-foul], [data-timeout]')
        .forEach((control) => { control.disabled = true; });
    }
    if (locked) feedback('Basketball storage is read-only. Match controls are disabled.', true);
    else if (recovered) feedback('Basketball data was recovered from its backup. Review the match before continuing.');
    else if (next.storage && next.storage.lastError) feedback(`Basketball save failed: ${next.storage.lastError}`, true);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    byId('btn-basketball-create-match').addEventListener('click', createMatch);
    byId('btn-basketball-new-match').addEventListener('click', () => showView('basketballSetup', '#basketball-setup-title'));
    byId('btn-basketball-clock-toggle').addEventListener('click', () => act(() => window.bosAPI.basketball.toggleClock()));
    byId('btn-basketball-end-timeout').addEventListener('click', () => act(() => window.bosAPI.basketball.endTimeout()));
    byId('btn-basketball-set-clock').addEventListener('click', () => act(() => window.bosAPI.basketball.setClock(readSeconds('basketball-clock-input', 'Game clock', 3600))));
    byId('basketball-period-select').addEventListener('change', () => act(() => window.bosAPI.basketball.setPeriod(Number(byId('basketball-period-select').value))));
    byId('btn-basketball-next-period').addEventListener('click', () => {
      if (state && state.match) act(() => window.bosAPI.basketball.setPeriod(state.match.period + 1));
    });
    document.querySelectorAll('[data-shot]').forEach((button) => button.addEventListener('click', () => act(() => window.bosAPI.basketball.setShotClock(Number(button.dataset.shot)))));
    byId('btn-basketball-set-shot').addEventListener('click', () => act(() => window.bosAPI.basketball.setShotClock(readSeconds('basketball-shot-input', 'Shot clock', 60))));
    document.querySelectorAll('[data-points]').forEach((button) => button.addEventListener('click', () => {
      act(() => window.bosAPI.basketball.addScore(button.dataset.side, Number(button.dataset.points)));
    }));
    document.querySelectorAll('[data-adjust]').forEach((button) => button.addEventListener('click', () => {
      act(() => window.bosAPI.basketball.adjustScore(button.dataset.adjust, Number(button.dataset.delta)));
    }));
    document.querySelectorAll('[data-foul]').forEach((button) => button.addEventListener('click', () => {
      act(() => window.bosAPI.basketball.addFoul(button.dataset.foul));
    }));
    document.querySelectorAll('[data-timeout]').forEach((button) => button.addEventListener('click', () => {
      act(() => window.bosAPI.basketball.callTimeout(button.dataset.timeout));
    }));
    byId('btn-basketball-show-announcement').addEventListener('click', () => {
      act(() => window.bosAPI.basketball.setAnnouncement(byId('basketball-announcement-text').value));
    });
    byId('btn-basketball-clear-announcement').addEventListener('click', () => {
      const live = state && state.match && state.match.announcement.live;
      if (live) act(() => window.bosAPI.basketball.clearAnnouncement(live.id));
    });
    window.bosAPI.basketball.onChanged(render);
    window.bosAPI.basketball.getState().then(render).catch((error) => feedback(error.message, true));
  }

  return { init, openFromLanding };
})();
