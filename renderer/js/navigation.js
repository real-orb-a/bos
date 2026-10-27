// Small renderer-only navigation layer; existing control modules stay mounted and untouched.
document.addEventListener('DOMContentLoaded', () => {
  const views = {
    welcome: document.getElementById('welcome-view'),
    sports: document.getElementById('sports-view'),
    sportLanding: document.getElementById('sport-landing-view'),
    athleticsSetup: document.getElementById('athletics-setup-view'),
    basketballSetup: document.getElementById('basketball-setup-view'),
    basketballControl: document.getElementById('basketball-control-view'),
    volleyballSetup: document.getElementById('volleyball-setup-view'),
    volleyballControl: document.getElementById('volleyball-control-view'),
    controlRoom: document.getElementById('control-room-view')
  };
  const sportDetails = {
    Athletics: {
      description: 'Track and field workspace',
      available: 'Shared team names and broadcast graphic palettes can be configured.',
      planned: 'Competition definitions, heats, lanes, race timing, and results are planned.'
    },
    Netball: {
      description: 'Court sport workspace',
      available: 'Shared team names and broadcast graphic palettes can be configured.',
      planned: 'Netball-specific scoring and match controls are planned.'
    },
    Cricket: {
      description: 'Bat-and-ball workspace',
      available: 'Shared team names and broadcast graphic palettes can be configured.',
      planned: 'Cricket-specific scoring and match controls are planned.'
    },
    Volleyball: {
      description: 'Volleyball match control',
      available: 'Match setup, set scoring, team timeouts, court-side control, completed results, and on-screen announcements are available.',
      planned: 'The venue audio PA and player rotation are not controlled by BOS.'
    },
    Basketball: {
      description: 'Basketball match control',
      available: 'Independent match setup, scorekeeping, a configurable game clock, an offense timer, editable periods, and on-screen announcements are available.',
      planned: 'The venue audio PA and official statistics are not controlled by BOS.'
    }
  };

  function showView(name, focusSelector) {
    Object.entries(views).forEach(([key, view]) => view.classList.toggle('hidden', key !== name));
    document.body.dataset.view = name === 'controlRoom' ? 'control-room' : name;
    if (focusSelector) document.querySelector(focusSelector)?.focus();
  }
  window.BOSNavigation = { showView };

  const openSportSelection = () => {
    showView('sports', '#sports-title');
  };
  document.getElementById('btn-begin-setup').addEventListener('click', openSportSelection);
  document.getElementById('event-choice-school').addEventListener('click', openSportSelection);
  document.getElementById('btn-sports-back').addEventListener('click', () => {
    showView('welcome', '#welcome-title');
  });

  function openSharedTeamSettings() {
    document.getElementById('btn-open-settings').click();
    document.querySelector('.tab-btn[data-tab="tab-teams"]').click();
  }

  document.querySelectorAll('.sport-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const sport = tile.dataset.sport;
      if (sport === 'Football') {
        showView('controlRoom', '#btn-return-selection');
        return;
      }
      const details = sportDetails[sport];
      if (!details) return;
      document.getElementById('sport-landing-title').textContent = sport;
      document.getElementById('sport-landing-description').textContent = details.description;
      document.getElementById('sport-landing-available').textContent = details.available;
      document.getElementById('sport-landing-planned').textContent = details.planned;
      document.getElementById('sport-landing-icon').replaceChildren(tile.querySelector('.sport-icon svg').cloneNode(true));
      document.getElementById('btn-open-athletics-setup').classList.toggle('hidden', sport !== 'Athletics');
      document.getElementById('btn-open-volleyball').classList.toggle('hidden', sport !== 'Volleyball');
      document.getElementById('btn-open-basketball').classList.toggle('hidden', sport !== 'Basketball');
      const sharedTeamSettings = sport !== 'Basketball';
      document.getElementById('btn-open-shared-team-settings').classList.toggle('hidden', !sharedTeamSettings);
      document.querySelector('.sport-setup-note').textContent = sharedTeamSettings
        ? 'Team names, hotkeys, and graphic palettes are shared with the Football control room and its broadcast graphics.'
        : 'Basketball team names and match settings are saved independently from Football.';
      showView('sportLanding', '#sport-landing-title');
    });
  });

  const backToSports = () => showView('sports', '#sports-title');
  document.getElementById('btn-sport-landing-back').addEventListener('click', backToSports);
  document.getElementById('btn-open-shared-team-settings').addEventListener('click', openSharedTeamSettings);
  document.getElementById('btn-athletics-setup-team-settings').addEventListener('click', openSharedTeamSettings);
  document.getElementById('btn-open-athletics-setup').addEventListener('click', () => {
    showView('athleticsSetup', '#athletics-setup-title');
  });
  document.getElementById('btn-athletics-setup-back').addEventListener('click', () => {
    showView('sportLanding', '#sport-landing-title');
  });
  document.getElementById('btn-open-volleyball').addEventListener('click', () => window.VolleyballModule.openFromLanding());
  document.getElementById('btn-open-basketball').addEventListener('click', () => window.BasketballModule.openFromLanding());
  const returnToBasketballLanding = () => showView('sportLanding', '#sport-landing-title');
  document.getElementById('btn-basketball-setup-back').addEventListener('click', returnToBasketballLanding);
  document.getElementById('btn-basketball-setup-cancel').addEventListener('click', returnToBasketballLanding);
  document.getElementById('btn-basketball-back-sports').addEventListener('click', async () => {
    let state;
    try {
      state = await window.bosAPI.basketball.getState();
    } catch (error) {
      window.BOSUI.toast(error.message || 'Basketball match state could not be loaded.', { type: 'error' });
      return;
    }
    if (state.match && state.match.status !== 'FINAL') {
      const confirmed = await window.BOSUI.confirm({
        title: 'Leave Basketball control?',
        message: 'The saved match and clocks remain active. Leaving does not stop a running game clock.',
        confirmLabel: 'LEAVE CONTROL'
      });
      if (!confirmed) return;
    }
    backToSports();
  });
  const returnToVolleyballLanding = () => showView('sportLanding', '#sport-landing-title');
  document.getElementById('btn-volleyball-setup-back').addEventListener('click', returnToVolleyballLanding);
  document.getElementById('btn-volleyball-setup-cancel').addEventListener('click', returnToVolleyballLanding);
  document.getElementById('btn-volleyball-back-sports').addEventListener('click', async () => {
    let state;
    try {
      state = await window.bosAPI.volleyball.getState();
    } catch (error) {
      window.BOSUI.toast(error.message || 'Volleyball match state could not be loaded.', { type: 'error' });
      return;
    }
    const match = state && state.activeMatch;
    if (match && !['MATCH_COMPLETE'].includes(match.status)) {
      const confirmed = await window.BOSUI.confirm({
        title: 'Leave Volleyball control?',
        message: 'The match, timeout, scores, and graphics state remain saved. Leaving does not stop an active timeout.',
        confirmLabel: 'LEAVE CONTROL'
      });
      if (!confirmed) return;
    }
    backToSports();
  });

  document.getElementById('btn-return-selection').addEventListener('click', async () => {
    if (!document.getElementById('active-sequence-bar').classList.contains('hidden')) {
      window.BOSUI.toast('Finish or cancel the active goal sequence before leaving the control room.', { type: 'warning' });
      return;
    }
    const confirmed = await window.BOSUI.confirm({
      title: 'Return to sport selection?',
      message: 'The OBS broadcast and match clock will continue unchanged. Football controls will be hidden until you return to the control room.',
      confirmLabel: 'RETURN TO SPORTS'
    });
    if (confirmed) backToSports();
  });
});
