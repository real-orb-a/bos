document.addEventListener('DOMContentLoaded', async () => {
  const launchScreen = document.getElementById('slc-launch-screen');
  const homeStep = document.getElementById('slc-home-step');
  const modeStep = document.getElementById('slc-mode-step');
  const setupStep = document.getElementById('slc-setup-step');
  const teamSetup = document.querySelector('.slc-team-setup');
  const tableTennisSetup = document.getElementById('slc-table-tennis-setup');
  const participantHouseSelects = {
    home: document.getElementById('slc-home-house-select'),
    away: document.getElementById('slc-away-house-select')
  };
  const formError = document.getElementById('slc-form-error');
  const sessionOpsPanel = document.getElementById('session-ops-panel');
  const sessionFeedback = document.getElementById('session-ops-feedback');
  const sessionModes = {
    football: { title: 'FOOTBALL CONTROL', period: 'Half' },
    basketball: { title: 'BASKETBALL CONTROL', period: 'Quarter' },
    cricket: { title: 'CRICKET CONTROL', period: 'Innings' },
    netball: { title: 'NETBALL CONTROL', period: 'Quarter' },
    volleyball: { title: 'VOLLEYBALL CONTROL', period: 'Set' },
    'table-tennis': { title: 'TABLE TENNIS CONTROL', period: 'Game' },
    badminton: { title: 'BADMINTON CONTROL', period: 'Game' },
    athletics: { title: 'ATHLETICS CONTROL', period: 'Event' }
  };
  let currentSession = null;
  let selectedReplayName = '';
  let scorebugExpanded = false;
  let athleticsRelayMode = 'compact';
  let teamCatalog = [];
  let teamCatalogLoaded = false;
  let athleticsLastEventId = null;
  let athleticsPreviousPlaces = new Map();

  function athleteCodeFromName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0].replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase();
    return parts.map(part => part[0]).join('').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
  }

  function athleticsAthleteCode(event, house, name) {
    return event?.athleteShortCodes?.[house?.id]?.[name] || athleteCodeFromName(name) || 'ATH';
  }

  async function loadTeamCatalog() {
    try {
      teamCatalog = await window.slcAPI.teams.getCatalog();
      teamCatalogLoaded = true;
      populateParticipantHouseChoices();
      populateTableTennisHouses();
    } catch (e) {
      console.warn('Failed to load team catalog:', e);
      teamCatalog = [];
    }
  }

  loadTeamCatalog();

  function populateParticipantHouseChoices() {
    const activeHouses = teamCatalog.filter(house => house.active !== false);
    for (const [side, select] of Object.entries(participantHouseSelects)) {
      if (!select) continue;
      const previous = select.value;
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose a house…';
      select.appendChild(placeholder);
      activeHouses.forEach(house => {
        const option = document.createElement('option');
        option.value = house.id;
        option.textContent = house.name;
        select.appendChild(option);
      });
      const preferred = activeHouses[side === 'home' ? 0 : 1]?.id || '';
      select.value = activeHouses.some(house => house.id === previous) ? previous : preferred;
      setParticipantHouse(side, select.value);
    }
  }

  const modes = [
    ['football', 'Football'],
    ['basketball', 'Basketball'],
    ['cricket', 'Cricket'],
    ['netball', 'Netball'],
    ['volleyball', 'Volleyball'],
    ['table-tennis', 'Table Tennis'],
    ['badminton', 'Badminton'],
    ['athletics', 'Athletics']
  ];
  let selectedMode = null;
  let recoverableSession = null;
  const tableTennisFormat = document.getElementById('slc-table-tennis-format');
  const homeHouseSelect = document.getElementById('slc-table-tennis-home-house');
  const awayHouseSelect = document.getElementById('slc-table-tennis-away-house');
  function populateTableTennisHouses() {
    const activeHouses = teamCatalog.filter(house => house.active !== false);
    for (const [side, select] of [['home', homeHouseSelect], ['away', awayHouseSelect]]) {
      if (!select) continue;
      const previous = select.value;
      select.replaceChildren();
      activeHouses.forEach(house => {
        const option = document.createElement('option');
        option.value = house.id;
        option.textContent = house.name;
        select.appendChild(option);
      });
      const sharedSelection = participantHouseSelects[side]?.value;
      select.value = activeHouses.some(house => house.id === sharedSelection) ? sharedSelection
        : activeHouses.some(house => house.id === previous) ? previous
          : activeHouses[side === 'home' ? 0 : 1]?.id || '';
    }
    updateTableTennisHouseCard('home');
    updateTableTennisHouseCard('away');
  }

  function updateTableTennisHouseCard(side) {
    const select = side === 'home' ? homeHouseSelect : awayHouseSelect;
    const house = teamCatalog.find(item => item.id === select?.value);
    const name = document.getElementById(`slc-table-tennis-${side}-name`);
    const color = document.getElementById(`slc-table-tennis-${side}-color`);
    const logo = document.getElementById(`slc-table-tennis-${side}-logo`);
    const playerLabel = document.getElementById(`slc-table-tennis-${side}-player-label`);
    if (name) name.textContent = house?.name || 'Choose a house';
    if (color) color.style.backgroundColor = house?.primaryColor || house?.color || '#334155';
    if (logo) {
      logo.src = house?.logo || '';
      logo.classList.toggle('hidden', !house?.logo);
      logo.alt = house ? `${house.name} logo` : '';
    }
    if (playerLabel) playerLabel.textContent = `${house?.name || side.toUpperCase()} PLAYERS`;
  }

  homeHouseSelect.addEventListener('change', () => {
    if (homeHouseSelect.value === awayHouseSelect.value) {
      awayHouseSelect.value = teamCatalog.find(house => house.active !== false && house.id !== homeHouseSelect.value)?.id || '';
    }
    updateTableTennisHouseCard('home');
    updateTableTennisHouseCard('away');
    participantHouseSelects.home.value = homeHouseSelect.value;
    participantHouseSelects.away.value = awayHouseSelect.value;
    setParticipantHouse('home', homeHouseSelect.value);
    setParticipantHouse('away', awayHouseSelect.value);
  });
  awayHouseSelect.addEventListener('change', () => {
    if (awayHouseSelect.value === homeHouseSelect.value) {
      homeHouseSelect.value = teamCatalog.find(house => house.active !== false && house.id !== awayHouseSelect.value)?.id || '';
    }
    updateTableTennisHouseCard('home');
    updateTableTennisHouseCard('away');
    participantHouseSelects.home.value = homeHouseSelect.value;
    participantHouseSelects.away.value = awayHouseSelect.value;
    setParticipantHouse('home', homeHouseSelect.value);
    setParticipantHouse('away', awayHouseSelect.value);
  });

  const updateTableTennisSetup = () => {
    const doubles = tableTennisFormat.value === 'doubles';
    const usesRacketLineup = ['table-tennis', 'badminton'].includes(selectedMode);
    homeHouseSelect.required = usesRacketLineup;
    awayHouseSelect.required = usesRacketLineup;
    document.getElementById('slc-racket-lineup-title').textContent = `${selectedMode === 'badminton' ? 'BADMINTON' : 'TABLE TENNIS'} LINEUP`;
    document.getElementById('slc-racket-lineup-copy').textContent =
      'Enter each player’s name and their own short broadcast code (up to 3 characters).';
    for (const side of ['home', 'away']) {
      const starter = document.getElementById(`slc-table-tennis-${side}-player-1`);
      const partner = document.getElementById(`slc-table-tennis-${side}-player-2`);
      const partnerRow = document.getElementById(`slc-table-tennis-${side}-player-2-row`);
      const starterCode = document.getElementById(`slc-table-tennis-${side}-player-1-short`);
      const partnerCode = document.getElementById(`slc-table-tennis-${side}-player-2-short`);
      partnerRow.classList.toggle('hidden', !doubles);
      starter.required = usesRacketLineup;
      starterCode.required = usesRacketLineup;
      partner.required = usesRacketLineup && doubles;
      partnerCode.required = usesRacketLineup && doubles;
      if (!doubles) {
        partner.value = '';
        partnerCode.value = '';
      }
    }
  };
  tableTennisFormat.addEventListener('change', updateTableTennisSetup);
  updateTableTennisSetup();

  // Athletics events setup — houses come from teams.json (active teams)
  let athleticsEvents = [];
  let athleticsEditingResultId = null;

  function renderAthleticsEventsList() {
    const container = document.getElementById('athletics-events-items');
    if (!container) return;
    container.replaceChildren();
    athleticsEvents.forEach((event, index) => {
      const row = document.createElement('div');
      row.className = 'athletics-event-item';
      const nameCell = document.createElement('span');
      nameCell.className = 'athletics-event-name';
      nameCell.textContent = event.name;
      const typeCell = document.createElement('span');
      typeCell.className = 'athletics-event-type';
      typeCell.textContent = event.category === 'shot-put' ? 'Shot Put'
        : event.category === 'relay' ? 'Baton Relay' : 'Running';
      const athletesCell = document.createElement('span');
      athletesCell.className = 'athletics-event-athletes';
      const athleteCount = Object.values(event.athletes || {}).flat().length;
      const houseSummary = Object.entries(event.athletes || {}).map(([houseId, names]) => {
        const house = teamCatalog.find(item => item.id === houseId);
        return house && names.length ? `${house.name}: ${names.length}` : '';
      }).filter(Boolean).join(' · ');
      athletesCell.textContent = `${athleteCount} athlete${athleteCount !== 1 ? 's' : ''}${houseSummary ? ` · ${houseSummary}` : ''}`;
      if (event.category !== 'shot-put') athletesCell.textContent += event.resultRequired === false ? ' · roster order' : ' · result required';
      athletesCell.textContent += event.liveStandings === false ? ' · after only' : ' · live on air';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'REMOVE';
      removeBtn.className = 'athletics-event-remove';
      removeBtn.addEventListener('click', () => {
        athleticsEvents.splice(index, 1);
        renderAthleticsEventsList();
      });
      row.appendChild(nameCell);
      row.appendChild(typeCell);
      row.appendChild(athletesCell);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
  }

  async function openAthleticsEventModal() {
    try {
      if (!teamCatalogLoaded) {
        await loadTeamCatalog();
      }
      const typeSelect = document.getElementById('athletics-event-type');
      const category = (typeSelect && typeSelect.value) || 'running';

      const houses = teamCatalog.filter(t => t.active !== false);

      const modal = document.getElementById('athletics-event-modal');
      const housesEl = document.getElementById('athletics-event-modal-houses');
      const infoEl = document.getElementById('athletics-event-modal-info');
      const categoryBadge = document.getElementById('athletics-event-modal-category');
      const titleEl = document.getElementById('athletics-event-modal-title');

      if (!modal || !housesEl) return;
      const resultRequiredWrap = document.getElementById('athletics-result-required-wrap');
      const resultRequiredInput = document.getElementById('athletics-result-required');
      if (resultRequiredWrap) resultRequiredWrap.classList.toggle('hidden', category === 'shot-put');
      if (resultRequiredInput) resultRequiredInput.checked = true;

      const cfg = {
        running: { title: 'ADD RUNNERS TO EVENT', label: 'RUNNER', add: 'Add runner', min: 1, order: false },
        'shot-put': { title: 'SHOT PUT — ATHLETES', label: 'ATHLETE', add: 'Add athlete', min: 1, order: false },
        relay: { title: 'BATON RELAY — RUNNERS', label: 'RUNNER', add: 'Add runner', min: 2, order: true }
      }[category] || { title: 'ADD ATHLETES TO EVENT', label: 'ATHLETE', add: 'Add athlete', min: 1, order: false };

      const infoMap = {
        running: 'Add one or more runners for each participating house. Every runner competes as an individual.',
        'shot-put': 'Each athlete competes separately — add as many shot putters as needed per house.',
        relay: 'Enter runners in running order (baton hand-off order). Minimum 2 runners per house.'
      };

      if (titleEl) titleEl.textContent = cfg.title;
      if (categoryBadge) {
        categoryBadge.textContent = category === 'running' ? 'RUNNING'
          : category === 'shot-put' ? 'SHOT PUT' : 'BATON RELAY';
      }
      if (infoEl) {
        infoEl.replaceChildren();
        const message = document.createElement('span');
        message.className = 'athletics-event-modal-info-tag';
        message.textContent = infoMap[category];
        infoEl.appendChild(message);
      }

      housesEl.replaceChildren();

      houses.forEach(house => {
        const houseCard = document.createElement('div');
        houseCard.className = 'athletics-event-modal-house';
        houseCard.dataset.houseId = house.id;

        const header = document.createElement('div');
        header.className = 'athletics-event-modal-house-header';

        const colorMark = document.createElement('span');
        colorMark.className = 'athletics-event-modal-house-color';
        colorMark.style.backgroundColor = house.primaryColor || house.color || '#64748b';

        const houseLogo = document.createElement('img');
        houseLogo.className = 'athletics-event-modal-house-logo';
        houseLogo.alt = '';
        houseLogo.style.display = house.logo ? 'block' : 'none';
        if (house.logo) houseLogo.src = house.logo;

        const houseName = document.createElement('span');
        houseName.className = 'athletics-event-modal-house-name';
        houseName.textContent = house.name;

        header.appendChild(colorMark);
        if (house.logo) header.appendChild(houseLogo);
        header.appendChild(houseName);

        const body = document.createElement('div');
        body.className = 'athletics-event-modal-house-body';

        const label = document.createElement('label');
        label.className = 'athletics-event-modal-house-label';
        label.textContent = category === 'relay'
          ? 'RUNNERS (HANDOFF ORDER)'
          : category === 'running' ? 'RUNNERS' : 'ATHLETES';
        body.appendChild(label);

        const rowsContainer = document.createElement('div');
        rowsContainer.className = 'athlete-rows';
        body.appendChild(rowsContainer);

        const hint = document.createElement('p');
        hint.className = 'athlete-hint';
        hint.textContent = category === 'relay'
          ? 'Baton hand-off order: 1st → 2nd → 3rd … Enter each runner’s broadcast shortcode.'
          : category === 'shot-put'
            ? 'Each athlete competes separately and receives their own result row. Enter a broadcast shortcode.'
            : 'Each runner competes separately for this house. Enter a broadcast shortcode.';
        hint.style.display = 'block';
        body.appendChild(hint);

        const error = document.createElement('p');
        error.className = 'athlete-error';
        error.textContent = category === 'relay' ? 'Relay teams need at least 2 runners.' : '';
        body.appendChild(error);

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-add-athlete';
        addBtn.innerHTML = '<span aria-hidden="true">＋</span><span>Add ' + (category === 'shot-put' ? 'athlete' : 'runner') + '</span>';
        addBtn.title = `Add ${cfg.label.toLowerCase()}`;
        addBtn.style.display = 'inline-flex';
        body.appendChild(addBtn);
        const createInput = (name, index, shortCode = '') => {
          const row = document.createElement('div');
          row.className = 'athlete-row';

          const order = document.createElement('span');
          order.className = 'athlete-order';
          order.textContent = category === 'relay' ? index + 1 : '•';
          row.appendChild(order);

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'athletics-event-modal-house-input';
          input.placeholder = `${cfg.label} name`;
          input.maxLength = 80;
          input.setAttribute('aria-label', `${cfg.label} name for ${house.name}`);
          input.value = name || '';
          input.addEventListener('input', () => {
            clearHouseError(houseCard);
            if (shortCodeInput.dataset.auto !== 'false') shortCodeInput.value = athleteCodeFromName(input.value);
          });
          row.appendChild(input);

          const shortCodeInput = document.createElement('input');
          shortCodeInput.type = 'text';
          shortCodeInput.className = 'athletics-event-modal-shortcode-input';
          shortCodeInput.placeholder = 'CODE';
          shortCodeInput.maxLength = 4;
          shortCodeInput.pattern = '[A-Za-z0-9]{1,4}';
          shortCodeInput.value = shortCode || athleteCodeFromName(name);
          shortCodeInput.dataset.auto = shortCode ? 'false' : 'true';
          shortCodeInput.setAttribute('aria-label', `Broadcast shortcode for ${name || cfg.label.toLowerCase()} from ${house.name}`);
          shortCodeInput.addEventListener('input', () => {
            shortCodeInput.value = shortCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
            shortCodeInput.dataset.auto = 'false';
          });
          row.appendChild(shortCodeInput);

          {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-remove-athlete';
            remove.textContent = 'Remove';
            remove.title = `Remove ${cfg.label.toLowerCase()}`;
            remove.setAttribute('aria-label', `Remove ${cfg.label.toLowerCase()}`);
            remove.addEventListener('click', () => {
              row.remove();
              syncAthleteRowControls(rowsContainer, category);
            });
            row.appendChild(remove);
          }

          rowsContainer.appendChild(row);
        };

        const startCount = category === 'relay' ? cfg.min : 1;
        for (let i = 0; i < startCount; i++) {
          createInput('', i);
        }

        syncAthleteRowControls(rowsContainer, category);

        addBtn.addEventListener('click', () => {
          const count = rowsContainer.querySelectorAll('.athletics-event-modal-house-input').length;
          createInput('', count);
          syncAthleteRowControls(rowsContainer, category);
        });

        houseCard.appendChild(header);
        houseCard.appendChild(body);
        housesEl.appendChild(houseCard);
      });

      modal.classList.remove('hidden');
    } catch (e) {
      console.error('openAthleticsEventModal error:', e);
      alert('Error opening event modal: ' + e.message);
    }
  }

  function syncAthleteRowControls(container, category) {
    const min = category === 'relay' ? 2 : 1;
    const inputs = container.querySelectorAll('.athletics-event-modal-house-input');
    container.querySelectorAll('.btn-remove-athlete').forEach(btn => {
      btn.disabled = inputs.length <= min;
    });
    inputs.forEach((input, index) => {
      const order = input.parentElement.querySelector('.athlete-order');
      if (order) order.textContent = category === 'relay' ? index + 1 : '•';
    });
  }

  function clearHouseError(houseCard) {
    const error = houseCard.querySelector('.athlete-error');
    if (error) error.classList.remove('visible');
  }

  function closeAthleticsEventModal() {
    try {
      const modal = document.getElementById('athletics-event-modal');
      if (modal) modal.classList.add('hidden');
    } catch (e) {
      console.error('closeAthleticsEventModal error:', e);
    }
  }

  const modalClose = document.getElementById('athletics-event-modal-close');
  if (modalClose) modalClose.addEventListener('click', closeAthleticsEventModal);

  const modalCancel = document.getElementById('athletics-event-modal-cancel');
  if (modalCancel) modalCancel.addEventListener('click', closeAthleticsEventModal);

  const modalSave = document.getElementById('athletics-event-modal-save');
  if (modalSave) {
    modalSave.addEventListener('click', () => {
      try {
        const housesEl = document.getElementById('athletics-event-modal-houses');
        if (!housesEl) return;
        const houses = teamCatalog.filter(t => t.active !== false);
        const typeSelect = document.getElementById('athletics-event-type');
        const category = (typeSelect && typeSelect.value) || 'running';
        const athletes = {};
        const athleteShortCodes = {};
        let hasError = false;

        housesEl.querySelectorAll('.athletics-event-modal-house').forEach(houseCard => {
          clearHouseError(houseCard);
          const houseId = houseCard.dataset.houseId;
          const house = houses.find(h => h.id === houseId);
          if (!house) return;

          const assignmentEntries = Array.from(houseCard.querySelectorAll('.athlete-row')).map(row => ({
            name: row.querySelector('.athletics-event-modal-house-input').value.trim(),
            shortCode: row.querySelector('.athletics-event-modal-shortcode-input').value.trim().toUpperCase()
          })).filter(entry => entry.name);
          const names = assignmentEntries.map(entry => entry.name);
          const shortCodes = assignmentEntries.map(entry => entry.shortCode);

          let assignmentError = '';
          if (category === 'relay' && names.length === 1) {
            assignmentError = 'A relay team needs at least 2 runners.';
          } else if (names.length > (category === 'relay' ? 8 : 32)) {
            assignmentError = `This event supports up to ${category === 'relay' ? 8 : 32} names per house.`;
          } else if (new Set(names.map(value => value.toLocaleLowerCase())).size !== names.length) {
            assignmentError = 'Remove duplicate names for this house.';
          }
          if (assignmentError) {
            const error = houseCard.querySelector('.athlete-error');
            if (error) {
              error.textContent = assignmentError;
              error.classList.add('visible');
            }
            hasError = true;
          }

          const codeError = names.some((name, index) => !/^[A-Z0-9]{1,4}$/.test(shortCodes[index] || ''))
            ? 'Every athlete needs a 1–4 character shortcode.'
            : new Set(names.map((_, index) => shortCodes[index])).size !== names.length
              ? 'Shortcodes must be unique within each house.' : '';
          if (codeError) {
            const error = houseCard.querySelector('.athlete-error');
            if (error) { error.textContent = codeError; error.classList.add('visible'); }
            hasError = true;
          }

          if (names.length) {
            athletes[house.id] = names;
            athleteShortCodes[house.id] = Object.fromEntries(names.map((name, index) => [name, shortCodes[index]]));
          }
        });

        if (hasError) return;

        if (!Object.values(athletes).some(names => names.length > 0)) {
          const formError = document.getElementById('slc-form-error');
          if (formError) formError.textContent = category === 'shot-put'
            ? 'Add at least one shot put athlete before saving.'
            : category === 'relay'
              ? 'Add at least two runners to one relay team before saving.'
              : 'Add at least one athlete before saving.';
          return;
        }

        const nameInput = document.getElementById('athletics-event-name');
        if (!nameInput) return;

        const name = nameInput.value.trim();
        if (!name) {
          const formError = document.getElementById('slc-form-error');
          if (formError) formError.textContent = 'Please enter an event name.';
          return;
        }

        athleticsEvents.push({
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name, category, athletes, athleteShortCodes,
          resultRequired: category === 'shot-put' || document.getElementById('athletics-result-required').checked
        });
        renderAthleticsEventsList();
        closeAthleticsEventModal();
        nameInput.value = '';
      } catch (e) {
        console.error('Save event error:', e);
        alert('Error saving event: ' + e.message);
      }
    });
  }

      const addBtn = document.getElementById('athletics-add-event-btn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      try {
        await openAthleticsEventModal();
      } catch (e) {
        console.error('Add event error:', e);
        alert('Error opening event modal: ' + e.message);
      }
    });
  }

  // ---- Participant identity (name + color + logo) per side ----
  function setParticipantHouse(side, houseId) {
    const select = participantHouseSelects[side];
    const house = teamCatalog.find(item => item.id === houseId && item.active !== false);
    const preview = document.getElementById(`slc-${side}-logo-preview`);
    const colorMark = document.getElementById(`slc-${side}-color-mark`);
    const name = document.getElementById(`slc-${side}-selected-name`);
    if (house) {
      const color = house.primaryColor || house.color || '#64748b';
      name.textContent = house.name;
      preview.src = house.logo || '';
      preview.classList.toggle('hidden', !house.logo);
      colorMark.style.setProperty('--house-color', color);
      return;
    }
    name.textContent = 'Choose a house';
    preview.removeAttribute('src');
    preview.classList.add('hidden');
    colorMark.style.setProperty('--house-color', '#475569');
    if (select) select.value = '';
  }

  for (const side of ['home', 'away']) {
    participantHouseSelects[side].addEventListener('change', () => {
      const otherSide = side === 'home' ? 'away' : 'home';
      if (participantHouseSelects[side].value && participantHouseSelects[side].value === participantHouseSelects[otherSide].value) {
        const replacement = teamCatalog.find(house => house.active !== false && house.id !== participantHouseSelects[side].value);
        participantHouseSelects[otherSide].value = replacement?.id || '';
        setParticipantHouse(otherSide, participantHouseSelects[otherSide].value);
      }
      setParticipantHouse(side, participantHouseSelects[side].value);
      homeHouseSelect.value = participantHouseSelects.home.value;
      awayHouseSelect.value = participantHouseSelects.away.value;
      updateTableTennisHouseCard('home');
      updateTableTennisHouseCard('away');
    });
  }

  // Keep the selected house matchup when switching between sports.
  modes.forEach(([id, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slc-mode-card';
    button.textContent = label;
    button.addEventListener('click', () => {
      selectedMode = id;
      document.getElementById('slc-setup-title').textContent = `${label.toUpperCase()} SESSION SETUP`;
      const isAthletics = id === 'athletics';
      const needsTeams = !isAthletics;
      const usesHouseMatchup = ['table-tennis', 'badminton'].includes(id);
      document.getElementById('slc-home-team-label').textContent = isAthletics ? 'HOUSE' : 'HOME HOUSE';
      document.getElementById('slc-away-team-label').textContent = isAthletics ? 'HOUSE' : 'AWAY HOUSE';
      participantHouseSelects.home.required = needsTeams && !usesHouseMatchup;
      participantHouseSelects.away.required = needsTeams && !usesHouseMatchup;
      document.getElementById('slc-participant-home').classList.toggle('hidden', isAthletics || usesHouseMatchup);
      document.getElementById('slc-participant-away').classList.toggle('hidden', isAthletics || usesHouseMatchup);
      document.getElementById('slc-participant-hint').classList.toggle('hidden', false);
      document.getElementById('slc-participant-hint').textContent = isAthletics
        ? 'Register each competing house with its color and optional logo.'
        : usesHouseMatchup
          ? `${label} players and houses are selected below.`
          : 'Choose two different active houses. Their saved branding is shared across every sport.';
      tableTennisSetup.classList.toggle('hidden', !usesHouseMatchup);
      if (usesHouseMatchup) updateTableTennisSetup();
      if (usesHouseMatchup && !teamCatalogLoaded) loadTeamCatalog();
      populateTableTennisHouses();
      updateTableTennisSetup();
      document.getElementById('slc-athletics-setup').classList.toggle('hidden', id !== 'athletics');
      if (id === 'athletics') renderAthleticsEventsList();
      formError.textContent = '';
      showStep('setup');
      document.getElementById('slc-competition-name').focus();
    });
    document.getElementById('slc-mode-grid').appendChild(button);
  });

  const showStep = step => {
    homeStep.classList.toggle('hidden', step !== 'home');
    modeStep.classList.toggle('hidden', step !== 'modes');
    setupStep.classList.toggle('hidden', step !== 'setup');
  };

  const formatSessionSummary = session => {
    const competition = session.competition || {};
    const values = [
      competition.name || 'Untitled session',
      session.sportId || 'Sport',
      competition.venue,
      session.snapshot?.score
        ? `${session.snapshot.score.home.name} ${session.snapshot.score.home.score} – ${session.snapshot.score.away.score} ${session.snapshot.score.away.name}`
        : null,
      session.snapshot?.match?.clock?.formatted,
      session.status
    ];
    return values.filter(Boolean).join(' · ');
  };

  const setActiveSession = session => {
    currentSession = session;
    scorebugExpanded = session.modeId === 'athletics';
    athleticsRelayMode = 'compact';
    document.body.dataset.activeMode = session.modeId;
    launchScreen.classList.add('hidden');
    sessionOpsPanel.classList.remove('hidden');
    const contextBanner = document.getElementById('session-context-banner');
    const isFootball = session.modeId === 'football';
    const isAthletics = session.modeId === 'athletics';
    const hasMatchClock = ['football', 'basketball', 'netball'].includes(session.modeId);
    const legacyMatchControls = document.querySelector('.col-match');
    const operatorWorkspace = document.querySelector('.operator-workspace');
    const athleticsDashboard = document.getElementById('athletics-dashboard');
    const athleticsSideRail = document.querySelector('.athletics-side-rail');
    if (isFootball) {
      document.getElementById('football-controls-slot').appendChild(legacyMatchControls);
    } else {
      operatorWorkspace.appendChild(legacyMatchControls);
      legacyMatchControls.classList.add('hidden');
    }
    legacyMatchControls.classList.toggle('hidden', !isFootball);
    document.querySelector('.col-replay').classList.add('hidden');
    document.getElementById('session-scoreboard').classList.toggle('hidden', isAthletics || isFootball);
    const scorebugToggle = document.getElementById('session-scorebug-toggle');
    const scorebugControls = document.getElementById('scorebug-session-controls');
    const scorebugControlsAnchor = document.getElementById('scorebug-controls-anchor');
    scorebugToggle.classList.remove('hidden');
    renderScorebugModeSelect(session);
    document.getElementById('btn-reset-score').closest('.scorebug-control-row').classList.toggle('hidden', isAthletics);
    document.getElementById('btn-toggle-screen-center-scorebug').closest('.scorebug-control-row').classList.toggle('hidden', isAthletics);
    document.getElementById('btn-toggle-scorebug').textContent = 'FADE SCOREBUG OUT';
    scorebugExpanded = isAthletics;
    renderScorebugModeSelect(session);
    if (isAthletics && session.athletics?.currentEvent?.category === 'relay') {
      scorebugExpanded = false;
      athleticsRelayMode = 'compact';
      window.slcAPI.graphics.setAthleticsRelayMode('compact').catch(reportSessionError);
    } else {
      window.slcAPI.graphics.setScorebugExpanded(scorebugExpanded).catch(reportSessionError);
    }
    const clockControls = document.getElementById('session-clock-controls');
    const clockControlsAnchor = document.getElementById('session-clock-controls-anchor');
    const replayOperations = document.getElementById('replay-operations');
    const replayOperationsAnchor = document.getElementById('replay-operations-anchor');
    const graphicsControls = document.querySelector('.col-graphics');
    const graphicsControlsAnchor = document.getElementById('graphics-controls-anchor');
    if (isAthletics) {
      athleticsDashboard.classList.remove('hidden');
      document.getElementById('athletics-tools').classList.remove('hidden');
      operatorWorkspace.appendChild(athleticsSideRail);
      document.getElementById('athletics-scorebug-controls-slot').appendChild(scorebugControls);
      document.getElementById('athletics-replay-slot').appendChild(replayOperations);
      document.getElementById('athletics-messages-slot').appendChild(graphicsControls);
    } else {
      athleticsDashboard.classList.add('hidden');
      athleticsDashboard.appendChild(athleticsSideRail);
      if (isFootball) scorebugControlsAnchor.after(scorebugControls);
      else if (sessionOpsPanel.querySelector('.panel-header')) {
        sessionOpsPanel.querySelector('.panel-header').after(scorebugControls);
      }
      clockControlsAnchor.after(clockControls);
      replayOperationsAnchor.before(replayOperations);
      graphicsControlsAnchor.after(graphicsControls);
    }
    document.getElementById('replay-operations').classList.toggle('hidden', false);
    document.getElementById('session-clock-controls').classList.toggle('hidden', !hasMatchClock || isFootball);
    document.getElementById('session-sport-stats').classList.toggle('hidden', isFootball || isAthletics);
    document.getElementById('session-volleyball-rules').classList.toggle('hidden', session.modeId !== 'volleyball');
    document.getElementById('session-participants-tools').classList.toggle('hidden', true);
    document.getElementById('athletics-tools').classList.toggle('hidden', session.modeId !== 'athletics');
    contextBanner.classList.toggle('hidden', isFootball);
    document.getElementById('session-context-title').textContent =
      `${session.competition.name} · ${session.modeId.replace(/-/g, ' ').toUpperCase()}`;
    document.getElementById('session-context-description').textContent =
      isFootball
          ? 'Football match controls, official score, graphics, and replay operations are active.'
          : isAthletics
            ? 'Live and final event standings are managed here; notices and replay controls are together in the side panel.'
            : `${sessionModes[session.modeId].title}. Score, period, replay, and graphics state are session-specific.`;
    document.getElementById('btn-end-session').classList.remove('hidden');
    document.getElementById('program-text').textContent = `PROGRAM: ${session.status}`;
    document.getElementById('session-ops-title').textContent = sessionModes[session.modeId].title;
    document.getElementById('session-ops-subtitle').textContent = session.competition.name;
    document.getElementById('session-title-input').value = session.competition.name;
    document.getElementById('session-mode-badge').textContent = session.modeId.replace(/-/g, ' ').toUpperCase();
    document.getElementById('session-basketball-controls').classList.toggle('hidden', session.modeId !== 'basketball');
    const resetScoreButton = document.getElementById('btn-reset-score');
    resetScoreButton.textContent = session.modeId === 'volleyball' ? 'RESET SCORE + SETS' : 'RESET SCORE';
    renderSession(session);
    refreshMatchState().catch(error => reportSessionError(error));
    refreshScore().catch(error => reportSessionError(error));
  };

  function renderScorebugModeSelect(session = currentSession) {
    const select = document.getElementById('session-scorebug-toggle');
    if (session?.modeId === 'athletics' && session.athletics?.currentEvent?.category === 'relay') {
      select.replaceChildren(...[
        ['compact', 'COMPACT · CURRENT SHORTCODE'],
        ['expanded', 'EXPANDED · CURRENT NAME'],
        ['team', 'FULL TEAM · HIGHLIGHT BATON RUNNER']
      ].map(([value, label]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
      }));
      select.value = athleticsRelayMode;
      return;
    }
    select.replaceChildren(...[
      ['compact', session?.modeId === 'athletics' ? 'COMPACT SCOREBUG' : 'COLLAPSED SCOREBUG'],
      ['expanded', 'EXPANDED SCOREBUG']
    ].map(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
    }));
    select.value = scorebugExpanded ? 'expanded' : 'compact';
  }

  const loadHealth = async () => {
    const obs = document.getElementById('slc-health-obs');
    const graphics = document.getElementById('slc-health-graphics');
    try {
      const status = await window.slcAPI.obs.getStatus();
      obs.textContent = status.connected ? 'CONNECTED' : status.connecting ? 'CONNECTING' : 'DISCONNECTED';
      obs.className = status.connected ? 'health-online' : status.connecting ? 'health-connecting' : 'health-offline';
    } catch (error) {
      obs.textContent = 'ERROR';
      obs.className = 'health-offline';
      document.getElementById('slc-health-message').textContent = error.message;
    }
    try {
      const status = await window.slcAPI.graphics.getServerStatus();
      graphics.textContent = status.state === 'running' ? `ONLINE · ${status.port}`
        : status.state === 'starting' ? 'CONNECTING…'
          : status.state === 'port-conflict' ? 'PORT UNAVAILABLE' : 'OFFLINE';
      graphics.className = status.state === 'running' ? 'health-online'
        : status.state === 'starting' ? 'health-connecting' : 'health-offline';
    } catch (error) {
      graphics.textContent = 'OFFLINE';
      graphics.className = 'health-offline';
      document.getElementById('slc-health-message').textContent = error.message;
    }
  };

  const beginSession = async session => {
    const readySession = session.status === 'SETUP'
      ? await window.slcAPI.session.activate()
      : session;
    setActiveSession(readySession);
  };

  const updateRecovery = state => {
    const resume = document.getElementById('slc-resume-session');
    const discard = document.getElementById('slc-discard-session');
    const summary = document.getElementById('slc-recovery-summary');
    recoverableSession = state.recoverable ? state.activeSession : null;
    resume.classList.toggle('hidden', !recoverableSession);
    discard.classList.toggle('hidden', !recoverableSession);
    summary.classList.toggle('hidden', !recoverableSession);
    summary.textContent = recoverableSession ? `UNFINISHED SESSION · ${formatSessionSummary(recoverableSession)}` : '';
  };

  const reportSessionError = error => {
    sessionFeedback.textContent = error.message || 'The requested operation failed.';
    sessionFeedback.classList.add('error');
  };

  const reportSessionSuccess = message => {
    sessionFeedback.textContent = message;
    sessionFeedback.classList.remove('error');
  };

  async function runSessionAction(action, successMessage = 'Saved.') {
    try {
      const updated = await action();
      if (updated && updated.id && updated.modeId) {
        currentSession = updated;
        renderSession(updated);
      }
      reportSessionSuccess(successMessage);
      return updated;
    } catch (error) {
      reportSessionError(error);
      return null;
    }
  }

  function appendText(parent, tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
  }

  function renderSession(session) {
    if (!session) return;
    currentSession = session;
    document.getElementById('session-ops-subtitle').textContent = session.competition.name;
    const titleInput = document.getElementById('session-title-input');
    if (document.activeElement !== titleInput) titleInput.value = session.competition.name;
    if (session.teams) {
      const score = session.snapshot?.score || null;
      const racketMatch = ['table-tennis', 'badminton'].includes(session.modeId)
        ? (session.sportState?.racketMatch || session.sportState?.tableTennis)
        : null;
      for (const side of ['home', 'away']) {
        const team = session.teams[side];
        const displayedScore = score?.[side];
        const lineupEl = document.getElementById(`session-${side}-lineup`);
        const rawPlayers = racketMatch?.players?.[side];
        const players = Array.isArray(rawPlayers) ? rawPlayers.map(player =>
          typeof player === 'string' ? player : player?.name
        ).filter(name => typeof name === 'string' && name.trim()) : [];
        document.getElementById(`session-${side}-name`).textContent =
          racketMatch && players.length ? players.join('   ·   ') : team.name;
        lineupEl.replaceChildren();
        lineupEl.classList.toggle('hidden', !racketMatch || players.length === 0);
        if (racketMatch && players.length) {
          const teamSubtitle = document.createElement('span');
          teamSubtitle.className = 'session-player-team';
          const teamShort = team.shortName || team.short || team.name.slice(0, 3).toUpperCase();
          teamSubtitle.textContent = `${team.name} (${teamShort})`;
          lineupEl.append(teamSubtitle);
        }
        document.getElementById(`session-${side}-score`).textContent =
          String(displayedScore?.score ?? team.score ?? 0);
        const logo = document.getElementById(`session-${side}-logo`);
        const logoData = team.logo || displayedScore?.logo || '';
        logo.classList.toggle('hidden', !logoData);
        if (logoData) logo.src = logoData;
        renderScoreActions(side, session.modeId);
      }
    }
    renderSportStats(session);
    renderParticipants(session);
    if (session.modeId === 'athletics') renderAthletics(session);
  }

  function renderScoreActions(side, mode) {
    const container = document.getElementById(`session-${side}-score-actions`);
    container.replaceChildren();
    const increments = mode === 'basketball' ? [1, 2, 3]
      : mode === 'cricket' ? [1, 2, 3, 4, 6]
        : [1];
    increments.forEach(points => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-action-btn';
      button.textContent = `+${points}`;
      button.addEventListener('click', () => applyScore(side, points));
      container.appendChild(button);
      if (mode === 'basketball') {
        const subtract = document.createElement('button');
        subtract.type = 'button';
        subtract.className = 'secondary-action-btn';
        subtract.textContent = `−${points}`;
        subtract.addEventListener('click', () => applyScore(side, -points));
        container.appendChild(subtract);
      }
    });
    if (mode !== 'basketball') {
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'secondary-action-btn';
      minus.textContent = '−1';
      minus.addEventListener('click', () => applyScore(side, -1));
      container.appendChild(minus);
    }
  }

  async function applyScore(side, amount) {
    try {
      const outcome = await window.slcAPI.session.applyScoreChange(side, amount);
      currentSession = outcome.session;
      renderSession(outcome.session);
      for (const team of ['home', 'away']) {
        document.getElementById(`session-${team}-score`).textContent = String(outcome.score[team].score);
      }
      const completedPeriod = outcome.completed
        ? `${outcome.session.modeId === 'volleyball' ? 'Set' : 'Game'} ${outcome.completed.number}`
        : '';
      reportSessionSuccess(outcome.completed
        ? `${outcome.session.teams[outcome.completed.winner].name} wins ${completedPeriod}.`
        : 'Score updated.');
      if (outcome.completed) {
        const winner = outcome.session.teams[outcome.completed.winner].name;
        await window.slcAPI.graphics.showLowerThird({
          title: `${winner} WINS`,
          subtitle: `${completedPeriod} · ${outcome.completed.points.home}–${outcome.completed.points.away}`,
          duration: 8,
          position: 'bottom-center'
        });
      }
    } catch (error) {
      reportSessionError(error);
    }
  }

  async function refreshScore() {
    const [score, sessionState] = await Promise.all([
      window.slcAPI.score.get(),
      window.slcAPI.session.getState()
    ]);
    if (!currentSession || !sessionState.activeSession) return;
    currentSession = { ...sessionState.activeSession, snapshot: { ...sessionState.activeSession.snapshot, score } };
    for (const side of ['home', 'away']) {
      document.getElementById(`session-${side}-score`).textContent = String(score[side].score);
    }
  }

  async function refreshMatchState() {
    const match = await window.slcAPI.match.getState();
    renderClock(match.clock);
  }

  function renderClock(clock) {
    if (!clock) return;
    document.getElementById('session-clock-display').textContent = clock.formatted;
    const periodInput = document.getElementById('session-period-input');
    if (document.activeElement !== periodInput) periodInput.value = clock.period;
    document.getElementById('session-clock-toggle').textContent = clock.running ? 'PAUSE CLOCK' : 'START CLOCK';
    const startInput = document.getElementById('session-basketball-start-time');
    if (document.activeElement !== startInput) startInput.value = formatClockInput(clock.startSeconds);
    if (clock.offense) {
      renderOffenseClock(clock.offense);
    }
  }

  function renderOffenseClock(offense) {
    document.getElementById('session-offense-display').textContent = offense.display;
    document.getElementById('session-offense-toggle').textContent = offense.running ? 'PAUSE' : 'START';
    document.getElementById('session-offense-enabled').checked = offense.enabled === true;
    document.getElementById('session-offense-toggle').disabled = offense.enabled !== true;
    document.getElementById('session-offense-reset').disabled = offense.enabled !== true;
    const offenseInput = document.getElementById('session-offense-seconds');
    if (document.activeElement !== offenseInput) offenseInput.value = String(offense.limitSeconds);
  }

  function formatClockInput(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
  }

  function renderSportStats(session) {
    const stats = document.getElementById('session-sport-stats');
    stats.replaceChildren();
    const state = session.sportState || {};
    const addStat = (label, value, controls = []) => {
      const item = document.createElement('div');
      item.className = 'session-sport-stat';
      appendText(item, 'span', label);
      appendText(item, 'strong', String(value));
      controls.forEach(({ text, onClick }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary-action-btn';
        button.textContent = text;
        button.addEventListener('click', onClick);
        item.appendChild(button);
      });
      stats.appendChild(item);
    };
    if (session.modeId === 'cricket') {
      addStat('INNINGS', state.periodNumber || 1, [{
        text: 'NEXT',
        onClick: () => updateSportState({ periodNumber: Math.min(2, (state.periodNumber || 1) + 1), period: `${(state.periodNumber || 1) + 1}${(state.periodNumber || 1) === 1 ? 'nd' : 'rd'} Innings` })
      }]);
      for (const side of ['home', 'away']) {
        addStat(`${session.teams[side].name} WICKETS`, state.wickets?.[side] || 0, [
          { text: '+W', onClick: () => updateSportState({ wickets: { [side]: (state.wickets?.[side] || 0) + 1 } }) },
          { text: '−', onClick: () => updateSportState({ wickets: { [side]: Math.max(0, (state.wickets?.[side] || 0) - 1) } }) }
        ]);
        addStat(`${session.teams[side].name} OVERS`, state.overs?.[side] || 0, [
          { text: '+OVER', onClick: () => updateSportState({ overs: { [side]: (state.overs?.[side] || 0) + 1 } }) }
        ]);
      }
    } else if (['volleyball', 'table-tennis', 'badminton'].includes(session.modeId)) {
      for (const side of ['home', 'away']) {
        addStat(`${session.teams[side].name} SETS`, state.sets?.[side] || 0, [
          { text: '+', onClick: () => updateSportState({ sets: { [side]: (state.sets?.[side] || 0) + 1 } }) },
          { text: '−', onClick: () => updateSportState({ sets: { [side]: Math.max(0, (state.sets?.[side] || 0) - 1) } }) }
        ]);
      }
      if (session.modeId !== 'volleyball') {
        addStat('POINTS TO WIN', state.pointsToWin || 21);
      }
    } else     if (session.modeId === 'basketball') {
      stats.classList.add('hidden');
      return;
    }
    const volleyballRules = document.getElementById('session-volleyball-rules');
    const tableTennisRules = document.getElementById('session-table-tennis-rules');
    volleyballRules.classList.toggle('hidden', session.modeId !== 'volleyball');
    tableTennisRules.classList.toggle('hidden', session.modeId !== 'table-tennis');
    if (!volleyballRules.contains(document.activeElement)) {
      document.getElementById('volleyball-points-to-win').value = String(state.pointsToWin || 25);
      document.getElementById('volleyball-deciding-points-to-win').value =
        String(state.decidingSetPointsToWin || 15);
      document.getElementById('volleyball-points-to-win-by').value = String(state.pointsToWinBy || 2);
    }
    if (!tableTennisRules.contains(document.activeElement)) {
      document.getElementById('table-tennis-points-to-win').value = String(state.pointsToWin || 11);
    }
    stats.classList.toggle('hidden', stats.childElementCount === 0);
  }

  async function updateSportState(patch) {
    const result = await runSessionAction(
      () => window.slcAPI.session.updateSportState(patch),
      'Sport state updated.'
    );
    if (result) renderSportStats(result);
  }

  function renderParticipants(session) {
    const list = document.getElementById('session-participant-list');
    list.replaceChildren();
    (session.participants || []).forEach(participant => {
      const row = document.createElement('div');
      row.className = 'session-record-row';
      const detail = document.createElement('div');
      appendText(detail, 'span', `${participant.name}${participant.number === null ? '' : ` · #${participant.number}`}`);
      appendText(detail, 'small', [participant.type.toUpperCase(), participant.team, participant.role].filter(Boolean).join(' · '));
      row.appendChild(detail);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'REMOVE';
      remove.addEventListener('click', () => runSessionAction(
        () => window.slcAPI.session.removeParticipant(participant.id),
        'Participant removed.'
      ));
      row.appendChild(remove);
      list.appendChild(row);
    });
    if (!list.childElementCount) appendText(list, 'div', 'No participants added yet.', 'session-record-row');
  }

  function renderAthletics(session) {
    const houses = session.athletics?.houses || [];
    const liveEvent = session.athletics?.currentEvent || null;
    renderScorebugModeSelect(session);
    const eventSelect = document.getElementById('athletics-live-event-select');
    const scheduledEvents = session.athletics?.events || [];
    const selectedEventId = liveEvent?.id || eventSelect.value;
    const liveStandingsControl = document.getElementById('athletics-live-standings-control');
    liveStandingsControl.checked = liveEvent?.liveStandings !== false;
    liveStandingsControl.disabled = !liveEvent;
    eventSelect.replaceChildren();
    const emptyEventOption = document.createElement('option');
    emptyEventOption.value = '';
    emptyEventOption.textContent = scheduledEvents.length ? 'Choose an event…' : 'No scheduled events';
    eventSelect.appendChild(emptyEventOption);
    scheduledEvents.forEach(event => {
      const option = document.createElement('option');
      option.value = event.id;
      option.textContent = `${event.name} · ${event.category === 'shot-put' ? 'Shot Put' : event.category === 'relay' ? 'Baton Relay' : 'Running'}`;
      eventSelect.appendChild(option);
    });
    if (selectedEventId && scheduledEvents.some(event => event.id === selectedEventId)) {
      eventSelect.value = selectedEventId;
    }
    eventSelect.disabled = scheduledEvents.length === 0;
    document.getElementById('athletics-event-form').querySelector('button[type="submit"]').disabled = scheduledEvents.length === 0;
    const displayMode = session.athletics?.displayMode === 'after' ? 'after' : 'live';
    const afterMode = displayMode === 'after';
    const liveTab = document.getElementById('athletics-view-live');
    const afterTab = document.getElementById('athletics-view-after');
    liveTab.classList.toggle('active', !afterMode);
    afterTab.classList.toggle('active', afterMode);
    liveTab.setAttribute('aria-selected', String(!afterMode));
    afterTab.setAttribute('aria-selected', String(afterMode));
    afterTab.disabled = !liveEvent;
    document.getElementById('athletics-live-panel').classList.toggle('hidden', afterMode);
    document.getElementById('athletics-after-panel').classList.toggle('hidden', !afterMode);
    document.getElementById('athletics-view-status').textContent = !liveEvent
      ? 'Choose an event to start.'
      : afterMode ? `AFTER · ${liveEvent.name} · final order on air`
        : liveEvent.liveStandings === false ? `LIVE · ${liveEvent.name} · standings hidden on air`
          : liveEvent.resultRequired === false ? `LIVE · ${liveEvent.name} · roster order on air`
          : `LIVE · ${liveEvent.name} · standings update on air`;
    document.getElementById('athletics-after-event-name').textContent = liveEvent?.name || 'FINAL RESULTS';
    document.getElementById('athletics-control-mode-label').textContent = afterMode ? 'AFTER EVENT RESULTS' : 'LIVE EVENT CONTROL';
    document.getElementById('athletics-tools').classList.toggle('hidden', afterMode);
    if (afterMode) athleticsEditingResultId = null;
    const houseList = document.getElementById('athletics-house-list');
    const houseSelect = document.getElementById('athletics-result-team');
    const shotPutHouseSelect = document.getElementById('athletics-shotput-team');
    const previousHouse = houseSelect.value;
    const previousShotPutHouse = shotPutHouseSelect.value;
    houseList.replaceChildren();
    houseSelect.replaceChildren();
    shotPutHouseSelect.replaceChildren();

    const eligibleHouses = liveEvent?.athletes && Object.keys(liveEvent.athletes).length
      ? houses.filter(house => {
        const names = liveEvent.athletes[house.id] || [];
        return liveEvent.category === 'relay' ? names.length >= 2 : names.length > 0;
      })
      : houses;
    eligibleHouses.forEach(house => {
      for (const select of [houseSelect, shotPutHouseSelect]) {
        const option = document.createElement('option');
        option.value = house.name;
        option.textContent = house.name;
        select.appendChild(option);
      }
    });
    for (const select of [houseSelect, shotPutHouseSelect]) {
      if (eligibleHouses.some(house => house.name === (select === houseSelect ? previousHouse : previousShotPutHouse))) {
        select.value = select === houseSelect ? previousHouse : previousShotPutHouse;
      }
      select.disabled = eligibleHouses.length === 0;
    }

    houses.forEach(house => {

      const row = document.createElement('div');
      row.className = 'athletics-house-row';
      if (house.logo) {
        const logo = document.createElement('img');
        logo.src = house.logo;
        logo.alt = '';
        row.appendChild(logo);
      } else {
        const badge = appendText(row, 'span', house.name.slice(0, 1).toUpperCase(), 'athletics-house-badge');
        badge.style.backgroundColor = house.color || '#64748b';
      }
      appendText(row, 'span', house.name);
      const uploadLabel = appendText(row, 'label', house.logo ? 'CHANGE LOGO' : 'ADD LOGO', 'session-logo-upload');
      const upload = document.createElement('input');
      upload.type = 'file';
      upload.accept = '.svg,image/svg+xml,image/png,image/jpeg';
      upload.addEventListener('change', async event => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 750 * 1024) {
          reportSessionError(new Error('House logo must be smaller than 750 KB.'));
          input.value = '';
          return;
        }
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('House logo file could not be read.'));
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
          });
          const updated = await window.slcAPI.session.setAthleticsHouseLogo(house.id, dataUrl);
          currentSession = updated;
          renderAthletics(updated);
          reportSessionSuccess(`${house.name} logo saved.`);
        } catch (error) {
          reportSessionError(error);
        } finally {
          input.value = '';
        }
      });
      uploadLabel.appendChild(upload);
      houseList.appendChild(row);
    });
    document.getElementById('athletics-active-event').textContent =
      liveEvent ? `LIVE STANDINGS · ${liveEvent.name}` : 'SELECT A SCHEDULED EVENT TO RECORD RESULTS';
    document.getElementById('athletics-record-result').disabled = !liveEvent || afterMode;
    document.querySelector('#athletics-shotput-form button[type="submit"]').disabled = !liveEvent || afterMode;
    document.getElementById('athletics-cancel-edit').classList.toggle('hidden', !athleticsEditingResultId);
    document.getElementById('athletics-record-result').textContent = athleticsEditingResultId ? 'SAVE RESULT CHANGES' : 'ADD TO LIVE STANDINGS';
    const rosterOrder = !!liveEvent && liveEvent.category !== 'shot-put' && liveEvent.resultRequired === false;
    const isShotPut = liveEvent?.category === 'shot-put';
    document.getElementById('athletics-result-form').classList.toggle('hidden', isShotPut || rosterOrder);
    document.getElementById('athletics-roster-order-hint').classList.toggle('hidden', !rosterOrder || afterMode);
    document.getElementById('athletics-record-result').disabled = !liveEvent || afterMode || rosterOrder;
    document.querySelectorAll('#athletics-result-form input, #athletics-result-form select, #athletics-result-form textarea')
      .forEach(control => { control.disabled = !liveEvent || afterMode; });
    document.querySelectorAll('#athletics-shotput-form input, #athletics-shotput-form select')
      .forEach(control => { control.disabled = !liveEvent || afterMode || (control.id === 'athletics-shotput-distance' && document.getElementById('athletics-shotput-foul').checked); });
    document.getElementById('athletics-shotput-form').classList.toggle('hidden', !isShotPut);
    document.getElementById('athletics-shotput-table-wrap').classList.toggle('hidden', !isShotPut);
    document.getElementById('athletics-record-result').classList.toggle('hidden', isShotPut);
    renderShotPutAttempts(liveEvent);
    renderAthleticsEventStandings(liveEvent, houses, displayMode);
    updateRelayResultFields(liveEvent);
    updateAthleticsRosterInputs(liveEvent, houses);

  }

  function updateRelayResultFields(event) {
    const isRelay = event?.category === 'relay';
    document.getElementById('athletics-athlete-label').classList.toggle('hidden', isRelay);
    document.getElementById('athletics-runners-label').classList.toggle('hidden', !isRelay);
    document.getElementById('athletics-result-athlete').required = event?.category === 'running';
    document.getElementById('athletics-result-runners').required = isRelay;
    document.getElementById('athletics-result-runners').readOnly = true;
  }

  function setAthleteSelect(select, names) {
    const previous = select.value;
    select.replaceChildren();
    if (!names.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No athletes assigned to this house';
      select.appendChild(option);
      select.disabled = true;
      return;
    }
    names.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    if (names.includes(previous)) select.value = previous;
    select.disabled = false;
  }

  function updateAthleticsRosterInputs(event = currentSession?.athletics?.currentEvent, houses = currentSession?.athletics?.houses || []) {
    const runningTeam = houses.find(house => house.name === document.getElementById('athletics-result-team').value);
    const shotPutTeam = houses.find(house => house.name === document.getElementById('athletics-shotput-team').value);
    const rosterFor = house => house && Array.isArray(event?.athletes?.[house.id]) ? event.athletes[house.id] : [];
    setAthleteSelect(document.getElementById('athletics-result-athlete'), rosterFor(runningTeam));
    setAthleteSelect(document.getElementById('athletics-shotput-athlete'), rosterFor(shotPutTeam));
    const relayNames = event?.category === 'relay' ? rosterFor(runningTeam) : [];
    document.getElementById('athletics-result-runners').value = relayNames.join(', ');
  }

  function renderShotPutAttempts(event) {
    const body = document.getElementById('athletics-shotput-table-body');
    body.replaceChildren();
    (event?.category === 'shot-put' ? event.results : []).forEach(result => {
      const row = document.createElement('tr');
      const athlete = document.createElement('th');
      athlete.scope = 'row';
      const house = currentSession?.athletics?.houses?.find(item => item.name === result.team);
      athlete.textContent = `${athleticsAthleteCode(event, house, result.athleteName)} · ${result.team}`;
      athlete.title = `${result.athleteName} · ${result.team}`;
      row.appendChild(athlete);
      for (let index = 0; index < 6; index++) {
        const cell = document.createElement('td');
        const distance = result.attempts?.[index];
        cell.textContent = distance === null ? 'FOUL' : (Number.isFinite(distance) ? `${distance.toFixed(2)} m` : '—');
        if (distance === null) cell.classList.add('athletics-shotput-foul');
        row.appendChild(cell);
      }
      const final = document.createElement('td');
      final.textContent = result.bestDistance
        ? `${result.bestDistance.toFixed(2)} m · #${result.place}`
        : '—';
      row.appendChild(final);
      body.appendChild(row);
    });
    if (event?.category === 'shot-put' && !body.childElementCount) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.textContent = 'Attempt distances will appear here as they are recorded.';
      row.appendChild(cell);
      body.appendChild(row);
    }
  }

  function appendAthleticsHouseMark(parent, house) {
    const swatch = appendText(parent, 'span', '', 'athletics-result-team-color');
    swatch.style.backgroundColor = house?.color || '#64748b';
    swatch.title = house?.name ? `${house.name} team color` : 'Team color';
    swatch.setAttribute('aria-label', swatch.title);
  }

  function renderAthleticsEventStandings(event, houses, displayMode = 'live') {
    const list = document.getElementById(displayMode === 'after' ? 'athletics-after-standings' : 'athletics-event-standings');
    const previousTops = new Map([...list.querySelectorAll('.athletics-result-row[data-result-id]')]
      .map(row => [row.dataset.resultId, row.getBoundingClientRect().top]));
    list.replaceChildren();
    if (!event) {
      appendText(list, 'div', 'Choose a scheduled event to see its standings.', 'athletics-empty-state');
      return;
    }
    const results = [...event.results].sort((a, b) => a.place - b.place);
    if (athleticsLastEventId !== event.id) {
      athleticsLastEventId = event.id;
      athleticsPreviousPlaces = new Map();
    }
    if (!results.length) {
      appendText(list, 'div', displayMode === 'after' ? 'No results have been entered for this event yet.' : 'No results yet. Add the first result above.', 'athletics-empty-state');
      return;
    }
    if (displayMode === 'live') appendText(list, 'div', event.resultRequired === false
      ? 'Drag a row by its background. Drop above or below another row to set race order · or use ↑ ↓ · roster only'
      : event.category === 'shot-put'
      ? 'Place · Athlete · House · Best distance'
      : 'Drag a row by its background. Drop above or below another row to set place · or use ↑ ↓ · Place · Athlete / relay · House · Result', 'athletics-standings-instruction');
    const currentPlaces = new Map();
    results.forEach((result, index) => {
      const row = document.createElement('div');
      row.className = `athletics-result-row ${displayMode === 'after' ? 'athletics-after-row' : ''}`;
      row.draggable = displayMode === 'live' && event.category !== 'shot-put';
      row.dataset.resultId = result.id;
      currentPlaces.set(result.id, result.place);
      const placeEl = appendText(row, 'span', String(result.place), 'athletics-result-place');
      placeEl.classList.add(`place-${result.place}`);
      const house = houses.find(item => item.name === result.team);
      const previousPlace = athleticsPreviousPlaces.get(result.id);
      const direction = previousPlace === undefined || previousPlace === result.place
        ? '' : result.place < previousPlace ? 'up' : 'down';
      if (direction) {
        row.classList.add(`athletics-rank-moved-${direction}`);
        const arrow = appendText(row, 'span', direction === 'up' ? '↑' : '↓', `athletics-rank-change athletics-rank-change-${direction}`);
        arrow.title = direction === 'up' ? 'Moved up in the standings' : 'Moved down in the standings';
        arrow.setAttribute('aria-label', arrow.title);
        setTimeout(() => {
          arrow.remove();
          row.classList.remove(`athletics-rank-moved-${direction}`);
        }, 1000);
      }
      appendAthleticsHouseMark(row, house);
      const athlete = document.createElement('div');
      athlete.className = 'athletics-result-athlete';
      const displayName = (result.runnerNames || []).length
        ? result.runnerNames.map(name => athleticsAthleteCode(event, house, name)).join(' › ')
        : athleticsAthleteCode(event, house, result.athleteName);
      const athleteLabel = appendText(athlete, 'strong', displayName);
      athleteLabel.title = (result.runnerNames || []).join(' → ') || result.athleteName;
      appendText(athlete, 'small', result.team);
      row.appendChild(athlete);
      if (event.resultRequired !== false) appendText(row, 'strong', result.result, 'athletics-result-measure');
      if (displayMode === 'live' && event.category !== 'shot-put') {
        const move = document.createElement('div');
        move.className = 'athletics-result-move';
        for (const [label, offset, title] of [['↑', -1, 'Move up one place'], ['↓', 1, 'Move down one place']]) {
          const button = appendText(move, 'button', label, 'athletics-result-move-btn');
          button.type = 'button';
          button.classList.add(offset < 0 ? 'athletics-result-move-up' : 'athletics-result-move-down');
          button.title = title;
          button.setAttribute('aria-label', `${title}: ${displayName}`);
          button.disabled = index + offset < 0 || index + offset >= results.length;
          button.addEventListener('click', async e => {
            e.preventDefault();
            e.stopPropagation();
            button.disabled = true;
            const ids = results.map(item => item.id);
            [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
            const updated = await runSessionAction(() => window.slcAPI.session.reorderAthleticsResults(ids), '');
            if (!updated) button.disabled = false;
          });
        }
        row.appendChild(move);
        if (event.category === 'relay' && Array.isArray(result.runnerNames) && result.runnerNames.length > 1) {
          const transfersComplete = (Number.isInteger(result.currentRunnerIndex) ? result.currentRunnerIndex : 0) >= result.runnerNames.length - 1;
          const transfer = appendText(row, 'button', transfersComplete ? 'TEAM FINISHED' : 'TRANSFER BATON', 'athletics-relay-transfer-btn');
          transfer.type = 'button';
          transfer.disabled = transfersComplete;
          transfer.title = transfersComplete ? 'The final runner has the baton' : 'Pass the baton to the next runner';
          transfer.addEventListener('click', async eventClick => {
            eventClick.preventDefault();
            eventClick.stopPropagation();
            transfer.disabled = true;
            let teamFinished = false;
            try {
              const transferResult = await window.slcAPI.graphics.transferAthleticsBaton(result.id);
              if (transferResult?.complete) {
                teamFinished = true;
                transfer.textContent = 'TEAM FINISHED';
                transfer.disabled = true;
                transfer.title = 'The final runner has the baton';
              }
            } catch (error) {
              reportSessionError(error);
            } finally {
              if (!teamFinished) transfer.disabled = false;
            }
          });
        }
        if (event.resultRequired !== false) {
          const edit = appendText(row, 'button', 'EDIT', 'athletics-result-edit');
          edit.type = 'button';
          edit.addEventListener('click', () => beginAthleticsResultEdit(result));
        }
      }
      if (displayMode === 'live' && event.resultRequired !== false) {
        const remove = appendText(row, 'button', 'REMOVE', 'athletics-result-remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${result.athleteName} from live standings`);
        remove.addEventListener('click', async () => {
          await runSessionAction(() => window.slcAPI.session.removeAthleticsResult(result.id), 'Result removed.');
        });
      }
      list.appendChild(row);
    });
    if (displayMode === 'live') {
      list.querySelectorAll('.athletics-result-row[data-result-id]').forEach(row => {
        const oldTop = previousTops.get(row.dataset.resultId);
        if (oldTop === undefined) return;
        const offset = oldTop - row.getBoundingClientRect().top;
        if (Math.abs(offset) > 1) row.animate(
          [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
          { duration: 420, easing: 'cubic-bezier(.2,.75,.25,1)' }
        );
      });
    }
    if (displayMode === 'live' && event.category !== 'shot-put') {
      let draggedId = null;
      list.querySelectorAll('.athletics-result-row').forEach(row => {
        row.addEventListener('dragstart', e => {
          if (e.target.closest('button')) { e.preventDefault(); return; }
          draggedId = row.dataset.resultId;
          row.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', draggedId);
        });
        row.addEventListener('dragend', () => {
          draggedId = null;
          list.querySelectorAll('.is-dragging, .is-drop-target, .drop-before, .drop-after')
            .forEach(item => item.classList.remove('is-dragging', 'is-drop-target', 'drop-before', 'drop-after'));
        });
        row.addEventListener('dragover', e => {
          e.preventDefault();
          if (!draggedId || draggedId === row.dataset.resultId) return;
          e.dataTransfer.dropEffect = 'move';
          row.classList.add('is-drop-target');
          const midpoint = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
          row.classList.toggle('drop-before', e.clientY < midpoint);
          row.classList.toggle('drop-after', e.clientY >= midpoint);
        });
        row.addEventListener('dragleave', e => {
          if (e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return;
          row.classList.remove('is-drop-target', 'drop-before', 'drop-after');
        });
        row.addEventListener('drop', async e => {
          e.preventDefault();
          const dropAfter = e.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
          row.classList.remove('is-drop-target', 'drop-before', 'drop-after');
          if (!draggedId || draggedId === row.dataset.resultId) return;
          const dragged = e.dataTransfer.getData('text/plain') || draggedId;
          const ids = results.map(item => item.id).filter(id => id !== dragged);
          const targetIndex = ids.indexOf(row.dataset.resultId);
          if (targetIndex < 0) return;
          ids.splice(targetIndex + (dropAfter ? 1 : 0), 0, dragged);
          await runSessionAction(() => window.slcAPI.session.reorderAthleticsResults(ids), '');
        });
      });
    }
    athleticsPreviousPlaces = currentPlaces;
  }

  function beginAthleticsResultEdit(result) {
    athleticsEditingResultId = result.id;
    const form = document.getElementById('athletics-result-form');
    document.getElementById('athletics-result-team').value = result.team;
    updateAthleticsRosterInputs(currentSession?.athletics?.currentEvent);
    document.getElementById('athletics-result-value').value = result.result;
    document.getElementById('athletics-result-place').value = result.place;
    if (result.runnerNames?.length) {
      document.getElementById('athletics-result-runners').value = result.runnerNames.join(', ');
    } else {
      document.getElementById('athletics-result-athlete').value = result.athleteName;
    }
    document.getElementById('athletics-cancel-edit').classList.remove('hidden');
    document.getElementById('athletics-record-result').textContent = 'SAVE RESULT CHANGES';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('athletics-result-value').focus();
  }

  document.getElementById('slc-new-session').addEventListener('click', async () => {
    if (recoverableSession) {
      const confirmed = window.confirm('Starting a new session will replace the unfinished session recovery record. Continue?');
      if (!confirmed) return;
      try {
        updateRecovery(await window.slcAPI.session.discard());
      } catch (error) {
        document.getElementById('slc-health-message').textContent = error.message;
        return;
      }
    }
    showStep('modes');
  });
  document.getElementById('slc-back-home').addEventListener('click', () => showStep('home'));
  document.getElementById('slc-back-modes').addEventListener('click', () => showStep('modes'));

  document.getElementById('slc-session-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.getElementById('slc-create-session');
    button.disabled = true;
    formError.textContent = '';
    try {
      const selectedHouse = side => {
        const id = ['table-tennis', 'badminton'].includes(selectedMode)
          ? document.getElementById(`slc-table-tennis-${side}-house`).value
          : participantHouseSelects[side].value;
        if (!id) throw new Error(`Choose the ${side} house.`);
        const house = teamCatalog.find(item => item.id === id && item.active !== false);
        if (!house) throw new Error(`Choose an active ${side} house.`);
        return {
          id: house.id,
          name: house.name,
          shortName: house.shortName || house.name.slice(0, 3).toUpperCase(),
          color: house.primaryColor || house.color || '#64748b',
          primaryColor: house.primaryColor || house.color || '#64748b',
          logo: house.logo || ''
        };
      };
      const homeHouse = selectedMode === 'athletics' ? null : selectedHouse('home');
      const awayHouse = selectedMode === 'athletics' ? null : selectedHouse('away');
      if (selectedMode === 'athletics') {
        if (athleticsEvents.length === 0) {
          throw new Error('Please add at least one event.');
        }
        athleticsEvents.forEach((evt, i) => {
          const hasAthletes = Object.values(evt.athletes || {}).some(a => a.length > 0);
          if (!hasAthletes) {
            throw new Error(`Event "${evt.name}" needs at least one athlete assigned.`);
          }
        });
      }
      if (homeHouse && awayHouse && homeHouse.id === awayHouse.id) {
        throw new Error('Choose two different houses for the match.');
      }
      const racketPlayers = ['home', 'away'].reduce((players, side) => {
        players[side] = [1, 2].map(index => ({
          name: document.getElementById(`slc-table-tennis-${side}-player-${index}`).value.trim(),
          shortCode: document.getElementById(`slc-table-tennis-${side}-player-${index}-short`).value.trim().toUpperCase()
        })).slice(0, tableTennisFormat.value === 'doubles' ? 2 : 1);
        return players;
      }, {});
      const session = await window.slcAPI.session.create({
        mode: selectedMode,
        competitionName: document.getElementById('slc-competition-name').value,
        shortName: document.getElementById('slc-short-name').value,
        season: document.getElementById('slc-season').value,
        division: document.getElementById('slc-division').value,
        venue: document.getElementById('slc-venue').value,
        date: document.getElementById('slc-date').value,
        homeTeam: selectedMode === 'athletics' ? undefined : homeHouse,
        awayTeam: selectedMode === 'athletics' ? undefined : awayHouse,
        homeTeamId: homeHouse?.id,
        awayTeamId: awayHouse?.id,
        athleticsEvents: selectedMode === 'athletics' ? athleticsEvents : undefined,
        ...(['table-tennis', 'badminton'].includes(selectedMode) ? {
          racketFormat: tableTennisFormat.value,
          racketPlayers
        } : {})
      });
      await beginSession(session);
    } catch (error) {
      formError.textContent = error.message || 'Session setup failed.';
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('slc-resume-session').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const session = await window.slcAPI.session.resume();
      setActiveSession(session);
    } catch (error) {
      document.getElementById('slc-health-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('slc-discard-session').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      updateRecovery(await window.slcAPI.session.discard());
    } catch (error) {
      document.getElementById('slc-health-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('btn-end-session').addEventListener('click', async () => {
    if (!document.getElementById('active-sequence-bar').classList.contains('hidden')) {
      window.alert('Finish or cancel the active broadcast sequence before ending this session.');
      return;
    }
    if (!window.confirm('End this broadcast session? The saved match state will remain available for recovery.')) return;
    try {
      await window.slcAPI.match.clockPause();
      await window.slcAPI.match.pauseOffenseClock();
      await window.slcAPI.session.end();
      document.getElementById('session-scorebug-toggle').classList.add('hidden');
      document.getElementById('scorebug-controls-anchor').after(document.getElementById('scorebug-session-controls'));
      document.body.removeAttribute('data-active-mode');
      document.getElementById('btn-end-session').classList.add('hidden');
      document.getElementById('session-context-banner').classList.add('hidden');
      sessionOpsPanel.classList.add('hidden');
      document.querySelector('.col-match').classList.remove('hidden');
      document.querySelector('.col-replay').classList.remove('hidden');
      launchScreen.classList.remove('hidden');
      showStep('home');
      updateRecovery(await window.slcAPI.session.getState());
    } catch (error) {
      window.alert(error.message || 'The session could not be ended.');
    }
  });

  document.getElementById('session-participant-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await runSessionAction(() => window.slcAPI.session.addParticipant({
      name: document.getElementById('session-participant-name').value,
      type: document.getElementById('session-participant-type').value,
      number: document.getElementById('session-participant-number').value,
      team: document.getElementById('session-participant-team').value
    }), 'Participant added.');
    if (result) form.reset();
  });

  for (const side of ['home', 'away']) {
    document.getElementById(`session-${side}-logo-file`).addEventListener('change', async event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 750 * 1024) {
        reportSessionError(new Error('Team logo must be smaller than 750 KB.'));
        input.value = '';
        return;
      }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Team logo file could not be read.'));
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        const updated = await window.slcAPI.session.setTeamLogo(side, dataUrl);
        currentSession = updated;
        renderSession(updated);
        await refreshScore();
        reportSessionSuccess(`${side === 'home' ? 'Home' : 'Away'} team logo saved.`);
      } catch (error) {
        reportSessionError(error);
      } finally {
        input.value = '';
      }
    });
  }

  document.getElementById('session-clock-toggle').addEventListener('click', async () => {
    const state = await runSessionAction(() => window.slcAPI.match.clockToggle(), 'Clock updated.');
    if (state) renderClock(state);
  });
  document.getElementById('session-clock-reset').addEventListener('click', async () => {
    const state = await runSessionAction(() => window.slcAPI.match.clockReset(), 'Clock reset.');
    if (state) renderClock(state);
  });
  document.getElementById('session-scorebug-toggle').addEventListener('change', async event => {
    const select = event.currentTarget;
    const previousRelayMode = athleticsRelayMode;
    const previousExpanded = scorebugExpanded;
    try {
      if (currentSession?.modeId === 'athletics' && currentSession.athletics?.currentEvent?.category === 'relay') {
        athleticsRelayMode = select.value;
        await window.slcAPI.graphics.setAthleticsRelayMode(athleticsRelayMode);
        scorebugExpanded = athleticsRelayMode !== 'compact';
      } else {
        scorebugExpanded = select.value === 'expanded';
        await window.slcAPI.graphics.setScorebugExpanded(scorebugExpanded);
      }
    } catch (error) {
      athleticsRelayMode = previousRelayMode;
      scorebugExpanded = previousExpanded;
      renderScorebugModeSelect();
      reportSessionError(error);
    } finally {
      const centerVisible = await window.slcAPI.graphics.getScreenCenterScorebugVisible().catch(() => false);
      select.disabled = centerVisible;
      select.classList.toggle('locked', centerVisible);
    }
  });
  document.getElementById('session-period-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.getElementById('session-period-input');
    const period = input.value.trim();
    if (!period) {
      reportSessionError(new Error('Period label cannot be empty.'));
      return;
    }
    const updated = await runSessionAction(
      () => Promise.all([
        currentSession?.modeId === 'basketball'
          ? window.slcAPI.session.updateSportState({ period })
          : Promise.resolve(currentSession),
        window.slcAPI.match.setPeriod(period)
      ]).then(([session]) => session),
      'Period label updated.'
    );
    if (updated) input.value = period;
  });

  document.getElementById('session-volleyball-rules').addEventListener('submit', async event => {
    event.preventDefault();
    const pointsToWin = Number(document.getElementById('volleyball-points-to-win').value);
    const decidingSetPointsToWin = Number(
      document.getElementById('volleyball-deciding-points-to-win').value
    );
    const pointsToWinBy = Number(document.getElementById('volleyball-points-to-win-by').value);
    if (![pointsToWin, decidingSetPointsToWin, pointsToWinBy].every(Number.isInteger) ||
        pointsToWin < 1 || pointsToWin > 999 ||
        decidingSetPointsToWin < 1 || decidingSetPointsToWin > 999 ||
        pointsToWinBy < 1 || pointsToWinBy > 10) {
      reportSessionError(new Error('Set points must be 1–999 and the win margin must be 1–10.'));
      return;
    }
    await runSessionAction(
      () => window.slcAPI.session.updateSportState({
        pointsToWin,
        decidingSetPointsToWin,
        pointsToWinBy
      }),
      'Volleyball set rules updated.'
    );
  });

  document.getElementById('session-table-tennis-rules').addEventListener('submit', async event => {
    event.preventDefault();
    const pointsToWin = Number(document.getElementById('table-tennis-points-to-win').value);
    if (!Number.isInteger(pointsToWin) || pointsToWin < 1 || pointsToWin > 999) {
      reportSessionError(new Error('Game points must be a whole number from 1 to 999.'));
      return;
    }
    await runSessionAction(
      () => window.slcAPI.session.updateSportState({ pointsToWin }),
      'Table tennis game rules updated.'
    );
  });

  document.getElementById('session-basketball-start-form').addEventListener('submit', async event => {
    event.preventDefault();
    const value = document.getElementById('session-basketball-start-time').value.trim();
    const match = /^(\d{1,3}):([0-5]\d)$/.exec(value);
    if (!match) {
      reportSessionError(new Error('Game start time must use MM:SS with seconds from 00 to 59.'));
      return;
    }
    const seconds = Number(match[1]) * 60 + Number(match[2]);
    const clock = await window.slcAPI.match.getState();
    if (seconds > clock.clock.regulationSeconds) {
      reportSessionError(new Error('Game start time cannot exceed the configured quarter length.'));
      return;
    }
    const updated = await runSessionAction(
      () => window.slcAPI.match.setStartTime(seconds),
      'Basketball game start time updated.'
    );
    if (updated) refreshMatchState().catch(reportSessionError);
  });

  document.getElementById('session-offense-form').addEventListener('submit', async event => {
    event.preventDefault();
    const seconds = Number(document.getElementById('session-offense-seconds').value);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
      reportSessionError(new Error('Offense timer must be a whole number from 1 to 120 seconds.'));
      return;
    }
    try {
      const state = await window.slcAPI.match.setOffenseClock({ seconds, limitSeconds: seconds });
      document.getElementById('session-offense-display').textContent = state.display;
      reportSessionSuccess('Offense timer configured.');
    } catch (error) {
      reportSessionError(error);
    }
  });

  document.getElementById('session-offense-toggle').addEventListener('click', async () => {
    try {
      const state = await window.slcAPI.match.toggleOffenseClock();
      document.getElementById('session-offense-display').textContent = state.display;
      document.getElementById('session-offense-toggle').textContent = state.running ? 'PAUSE' : 'START';
    } catch (error) {
      reportSessionError(error);
    }
  });
  document.getElementById('session-offense-enabled').addEventListener('change', async event => {
    const enabled = event.currentTarget.checked;
    try {
      const state = await window.slcAPI.match.setOffenseClockEnabled(enabled);
      renderOffenseClock(state);
    } catch (error) {
      event.currentTarget.checked = !enabled;
      reportSessionError(error);
    }
  });

  document.getElementById('session-offense-reset').addEventListener('click', async () => {
    try {
      const state = await window.slcAPI.match.resetOffenseClock();
      document.getElementById('session-offense-display').textContent = state.display;
      document.getElementById('session-offense-toggle').textContent = 'START';
    } catch (error) {
      reportSessionError(error);
    }
  });

  document.getElementById('athletics-house-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = document.getElementById('athletics-house-name').value;
    const result = await runSessionAction(
      () => window.slcAPI.session.addAthleticsHouse(name),
      'House added.'
    );
    if (result) {
      form.reset();
      renderAthletics(result);
    }
  });

  document.getElementById('session-title-form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = document.getElementById('session-title-input').value.trim();
    await runSessionAction(
      () => window.slcAPI.session.updateCompetitionName(name),
      'On-screen competition or event name updated.'
    );
  });

  document.getElementById('athletics-event-form').addEventListener('submit', async event => {
    event.preventDefault();
    athleticsEditingResultId = null;
    const result = await runSessionAction(() => window.slcAPI.session.setAthleticsEvent({
      eventId: document.getElementById('athletics-live-event-select').value
    }), '');
    if (result) {
      if (result.athletics?.currentEvent?.category === 'relay') athleticsRelayMode = 'compact';
      renderAthletics(result);
      renderScorebugModeSelect();
    }
  });

  document.getElementById('athletics-result-team').addEventListener('change', () => updateAthleticsRosterInputs());
  document.getElementById('athletics-shotput-team').addEventListener('change', () => updateAthleticsRosterInputs());

  for (const [buttonId, mode] of [['athletics-view-live', 'live'], ['athletics-view-after', 'after']]) {
    document.getElementById(buttonId).addEventListener('click', async () => {
      if (!currentSession?.athletics?.currentEvent) return;
      const updated = await runSessionAction(
        () => window.slcAPI.session.setAthleticsDisplayMode(mode),
        mode === 'live' ? 'Live results are on air.' : 'After-event results are on air.'
      );
      if (updated) renderAthletics(updated);
    });
  }

  document.getElementById('athletics-live-standings-control').addEventListener('change', async event => {
    const enabled = event.currentTarget.checked;
    const updated = await runSessionAction(() => window.slcAPI.session.setAthleticsLiveStandings(enabled), '');
    if (!updated) event.currentTarget.checked = !enabled;
  });

  document.getElementById('athletics-cancel-edit').addEventListener('click', () => {
    athleticsEditingResultId = null;
    renderAthletics(currentSession);
  });

  document.getElementById('athletics-result-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = {
      resultId: athleticsEditingResultId,
      athleteName: document.getElementById('athletics-result-athlete').value ||
        document.getElementById('athletics-result-runners').value.split(',').map(name => name.trim()).filter(Boolean).join(' → '),
      runnerNames: document.getElementById('athletics-result-runners').value.split(',').map(name => name.trim()).filter(Boolean),
      team: document.getElementById('athletics-result-team').value,
      result: document.getElementById('athletics-result-value').value,
      place: Number(document.getElementById('athletics-result-place').value)
    };
    const wasEditing = Boolean(athleticsEditingResultId);
    const result = await runSessionAction(() => wasEditing
      ? window.slcAPI.session.updateAthleticsResult(input)
      : window.slcAPI.session.recordAthleticsResult(input), wasEditing ? 'Result changes saved.' : 'Live standings updated.');
    if (result) {
      athleticsEditingResultId = null;
      document.getElementById('athletics-result-value').value = '';
      document.getElementById('athletics-result-place').value = '1';
      form.reset();
      renderAthletics(result);
    }
  });

  const foulCheckbox = document.getElementById('athletics-shotput-foul');
  const distanceInput = document.getElementById('athletics-shotput-distance');
  foulCheckbox.addEventListener('change', () => {
    distanceInput.disabled = foulCheckbox.checked;
    if (foulCheckbox.checked) distanceInput.value = '';
  });

  document.getElementById('athletics-shotput-form').addEventListener('submit', async event => {
    event.preventDefault();
    const foul = foulCheckbox.checked;
    distanceInput.disabled = foul;
    const distance = foul ? null : Number(distanceInput.value);
    const result = await runSessionAction(() => window.slcAPI.session.recordAthleticsResult({
      athleteName: document.getElementById('athletics-shotput-athlete').value,
      team: document.getElementById('athletics-shotput-team').value,
      attempt: Number(document.getElementById('athletics-shotput-attempt').value),
      distance,
      foul
    }), 'Shot Put attempt saved and standings recalculated.');
    if (result) {
      const savedAttempt = Number(document.getElementById('athletics-shotput-attempt').value);
      distanceInput.value = '';
      foulCheckbox.checked = false;
      distanceInput.disabled = false;
      document.getElementById('athletics-shotput-attempt').value = String(Math.min(savedAttempt + 1, 6));
      renderAthletics(result);
    }
  });

  document.getElementById('session-replay-capture').addEventListener('click', async () => {
    const result = await window.slcAPI.replay.captureAll();
    if (result.ok) reportSessionSuccess('Replay buffer save triggered in OBS.');
    else reportSessionError(new Error(result.error || 'Replay capture failed.'));
  });
  document.getElementById('session-replay-select').addEventListener('click', async () => {
    try {
      const name = await window.slcAPI.replay.chooseFile();
      if (name) {
        selectedReplayName = name;
        document.getElementById('session-replay-selected').textContent = name;
        document.getElementById('session-replay-air').disabled = false;
        reportSessionSuccess('Replay selected.');
      }
    } catch (error) {
      reportSessionError(error);
    }
  });
  document.getElementById('session-replay-air').addEventListener('click', async () => {
    try {
      await window.slcAPI.replay.air();
      document.getElementById('session-replay-stop').disabled = false;
      reportSessionSuccess(`${selectedReplayName} is on air.`);
    } catch (error) {
      reportSessionError(error);
    }
  });
  document.getElementById('session-replay-stop').addEventListener('click', async () => {
    try {
      await window.slcAPI.replay.stop();
      document.getElementById('session-replay-stop').disabled = true;
      reportSessionSuccess('Replay stopped. Returned to LIVE.');
    } catch (error) {
      reportSessionError(error);
    }
  });

  window.slcAPI.score.onChanged(refreshScore);
  window.slcAPI.match.onClockTick(renderClock);
  window.slcAPI.match.onClockChanged(renderClock);
  window.slcAPI.match.onOffenseTick(renderOffenseClock);

  try {
    updateRecovery(await window.slcAPI.session.getState());
  } catch (error) {
    document.getElementById('slc-health-message').textContent = error.message;
  }
  await loadHealth();
  window.slcAPI.obs.onStatusChanged(loadHealth);
  window.slcAPI.graphics.onServerStatusChanged(loadHealth);
  window.slcAPI.session.onStorageError(message => {
    document.getElementById('slc-health-message').textContent = `SESSION SAVE ERROR: ${message}`;
  });
});
