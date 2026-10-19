window.VolleyballModule = (() => {
  const byId = (id) => document.getElementById(id);
  const setupView = byId('volleyball-setup-view');
  const controlView = byId('volleyball-control-view');
  const setupFeedback = byId('vball-setup-feedback');
  const controlFeedback = byId('vball-control-feedback');
  const draft = byId('vball-announcement-draft');
  let currentState = null;
  let initialized = false;
  let requestInFlight = false;
  let correctionResultId = null;
  let announcementDraftRevision = 0;
  let announcementPreviewRevision = -1;
  let announcementSubmitting = false;

  const homeName = (match) => match.teams[match.homeTeamId].name;
  const awayName = (match) => match.teams[match.awayTeamId].name;
  const visibleMatch = (state) => state.activeMatch || state.completedResults[state.completedResults.length - 1] || null;

  function setFeedback(node, message, isError = false) {
    node.textContent = message || '';
    node.classList.toggle('error', !!isError);
  }

  function showView(name, focus) {
    window.BOSNavigation.showView(name, focus);
  }

  function parsePromptPoints(value) {
    if (!value.trim()) return [];
    return [...new Set(value.split(',').map((entry) => {
      const point = Number(entry.trim());
      if (!Number.isInteger(point)) throw new Error('Enter deciding-set prompt points as comma-separated whole numbers.');
      return point;
    }))];
  }

  function readSetup() {
    const bestOf = Number(byId('vball-best-of').value);
    return {
      competitionName: byId('vball-competition').value.trim(),
      matchName: byId('vball-match-name').value.trim(),
      homeTeamName: byId('vball-home-name').value.trim(),
      awayTeamName: byId('vball-away-name').value.trim(),
      startingServeTeam: byId('vball-first-serve').value,
      rules: {
        bestOf,
        regularSetTarget: Number(byId('vball-regular-target').value),
        decidingSetTarget: Number(byId('vball-deciding-target').value),
        winByTwo: byId('vball-win-by-two').checked,
        timeoutAllowance: Number(byId('vball-timeout-allowance').value),
        timeoutDurationSeconds: Number(byId('vball-timeout-seconds').value),
        timeoutResetPolicy: byId('vball-timeout-reset').value,
        sideChangePrompts: {
          atSetEnd: byId('vball-side-set-end').checked,
          decidingSetPoints: parsePromptPoints(byId('vball-side-deciding-points').value)
        },
        announcementMaxChars: Number(byId('vball-announcement-limit').value),
        completedResultLimit: Number(byId('vball-results-limit').value)
      }
    };
  }

  function validateSetup(setup) {
    if (!setup.competitionName || !setup.matchName || !setup.homeTeamName || !setup.awayTeamName) {
      throw new Error('Enter competition, match, and both team names.');
    }
    if (setup.homeTeamName.toLocaleLowerCase() === setup.awayTeamName.toLocaleLowerCase()) {
      throw new Error('Team names must be different.');
    }
    if (setup.rules.regularSetTarget < 1 || setup.rules.decidingSetTarget < 1) {
      throw new Error('Set point targets must be at least one.');
    }
  }

  async function perform(key, action, feedback = controlFeedback) {
    if (requestInFlight) return;
    requestInFlight = true;
    setFeedback(feedback, 'Saving…');
    try {
      await action();
      setFeedback(feedback, 'Saved.');
    } catch (error) {
      setFeedback(feedback, error.message || 'The action could not be saved.', true);
    } finally {
      requestInFlight = false;
      render(currentState);
    }
  }

  async function confirmAction(options) {
    return window.BOSUI.confirm(options);
  }

  async function createMatch() {
    setFeedback(setupFeedback, '');
    try {
      const setup = readSetup();
      validateSetup(setup);
      const created = await window.bosAPI.volleyball.createMatch(setup);
      await window.bosAPI.volleyball.startMatch();
      currentState = created;
      showView('volleyballControl', '#vball-control-title');
      render(await window.bosAPI.volleyball.getState());
      setFeedback(controlFeedback, 'Match started.');
    } catch (error) {
      setFeedback(setupFeedback, error.message || 'Match setup could not be saved.', true);
    }
  }

  async function openFromLanding() {
    try {
      currentState = await window.bosAPI.volleyball.getState();
      const match = visibleMatch(currentState);
      if (currentState.storage && currentState.storage.writesBlocked) {
        showView('volleyballSetup', '#volleyball-setup-title');
        setFeedback(setupFeedback, 'Volleyball storage needs recovery. Existing data was preserved; changes are disabled.', true);
        return;
      }
      if (match) {
        showView('volleyballControl', '#vball-control-title');
        render(currentState);
      } else {
        showView('volleyballSetup', '#volleyball-setup-title');
      }
    } catch (error) {
      setFeedback(setupFeedback, error.message, true);
      showView('volleyballSetup', '#volleyball-setup-title');
    }
  }

  function bind(id, handler) {
    byId(id).addEventListener('click', handler);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    bind('btn-volleyball-create-match', createMatch);
    bind('btn-volleyball-new-match', () => showView('volleyballSetup', '#volleyball-setup-title'));
    bind('btn-vball-start-match', () => perform('start', () => window.bosAPI.volleyball.startMatch()));
    bind('btn-vball-left-point', () => awardPoint('left'));
    bind('btn-vball-right-point', () => awardPoint('right'));
    bind('btn-vball-undo-point', undoPoint);
    bind('btn-vball-undo-sides', undoSides);
    bind('btn-vball-record-set', recordSet);
    bind('btn-vball-advance-set', () => perform('advance', () => window.bosAPI.volleyball.advanceSet()));
    bind('btn-vball-switch-sides', switchSides);
    bind('btn-vball-home-timeout', () => callTimeout('home'));
    bind('btn-vball-away-timeout', () => callTimeout('away'));
    bind('btn-vball-end-timeout', () => perform('timeout-end', () => window.bosAPI.volleyball.endTimeout('Operator ended timeout')));
    bind('btn-vball-cancel-timeout', cancelTimeout);
    bind('btn-vball-recovery-resume', () => resolveTimeoutRecovery('resume'));
    bind('btn-vball-recovery-end', () => resolveTimeoutRecovery('end'));
    bind('btn-vball-recovery-cancel', () => resolveTimeoutRecovery('cancel'));
    bind('btn-vball-prompt-switch', () => resolveSidePrompt('switch'));
    bind('btn-vball-prompt-dismiss', () => resolveSidePrompt('dismiss'));
    bind('btn-vball-prompt-defer', () => resolveSidePrompt('defer'));
    bind('btn-vball-preview-announcement', previewAnnouncement);
    bind('btn-vball-take-announcement-live', takeAnnouncementLive);
    bind('btn-vball-clear-announcement', clearAnnouncement);
    bind('btn-vball-correct-set', correctSet);
    bind('btn-vball-finalize-correction', finalizeCorrection);
    draft.addEventListener('input', () => {
      announcementDraftRevision++;
      announcementPreviewRevision = -1;
      byId('vball-announcement-preview').classList.add('hidden');
      updateAnnouncementCounter();
      updateAnnouncementControls();
    });
    window.bosAPI.volleyball.onChanged(render);
    window.bosAPI.volleyball.getState().then(render).catch((error) => setFeedback(controlFeedback, error.message, true));
  }

  async function awardPoint(side) {
    const match = currentState && currentState.activeMatch;
    if (!match) return;
    const teamId = side === 'left' ? match.courtSides.leftTeamId : match.courtSides.rightTeamId;
    const team = match.teams[teamId];
    if (!await confirmAction({ title: 'Award point?', message: `Award one point to ${team.name}?`, confirmLabel: 'AWARD POINT' })) return;
    perform('point', () => window.bosAPI.volleyball.scorePoint(teamId));
  }

  async function undoPoint() {
    const reason = byId('vball-correction-reason').value.trim();
    if (!reason) return setFeedback(controlFeedback, 'Enter a correction reason before undoing a point.', true);
    if (!await confirmAction({ title: 'Undo last point?', message: `The point correction will be recorded: ${reason}`, confirmLabel: 'UNDO POINT' })) return;
    perform('undo-point', () => window.bosAPI.volleyball.undoLastPoint(reason));
  }

  async function recordSet() {
    if (!await confirmAction({ title: 'Record set result?', message: 'Confirm the set winner before recording this set.', confirmLabel: 'RECORD SET' })) return;
    try {
      await window.bosAPI.volleyball.recordSetResult();
      setFeedback(controlFeedback, 'Set result recorded.');
    } catch (error) {
      if (!/retention limit/.test(error.message)) return setFeedback(controlFeedback, error.message, true);
      const pruneConfirmed = await confirmAction({ title: 'Result retention limit', message: `${error.message} Continue?`, confirmLabel: 'RECORD AND RETAIN POLICY' });
      if (pruneConfirmed) perform('record-set', () => window.bosAPI.volleyball.recordSetResult({ confirmRetention: true }));
    }
  }

  async function switchSides() {
    if (!await confirmAction({ title: 'Switch court sides?', message: 'Only the scoreboard presentation sides will change. Team identities and records remain unchanged.', confirmLabel: 'SWITCH SIDES' })) return;
    perform('switch-sides', () => window.bosAPI.volleyball.switchSides({ confirmed: true, reason: 'Operator confirmed manual switch' }));
  }

  async function undoSides() {
    const reason = byId('vball-correction-reason').value.trim();
    if (reason.length < 5) return setFeedback(controlFeedback, 'Enter a side-switch correction reason of at least 5 characters.', true);
    if (!await confirmAction({ title: 'Undo last side switch?', message: `The presentation-side correction will be recorded: ${reason}`, confirmLabel: 'UNDO SIDE SWITCH' })) return;
    perform('undo-sides', () => window.bosAPI.volleyball.undoLastSideSwitch(reason));
  }

  async function callTimeout(side) {
    const match = currentState && currentState.activeMatch;
    if (!match) return;
    const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId;
    const used = match.timeoutRecords.filter((timeout) => timeout.teamId === teamId && timeout.status !== 'CANCELLED' && (match.rules.timeoutResetPolicy !== 'eachSet' || timeout.setNumber === match.currentSetNumber)).length;
    const override = used >= match.rules.timeoutAllowance;
    let options = {};
    if (override) {
      const reason = byId('vball-timeout-override-reason').value.trim();
      if (reason.length < 5) return setFeedback(controlFeedback, 'Enter an override reason of at least 5 characters.', true);
      const confirmed = await confirmAction({ title: 'Override timeout allowance?', message: `This team has used its allowance. Record an authorized override? ${reason}`, confirmLabel: 'AUTHORIZE OVERRIDE' });
      if (!confirmed) return;
      options = { overrideConfirmed: true, overrideReason: reason };
    }
    perform('timeout-start', () => window.bosAPI.volleyball.startTimeout(teamId, options));
  }

  async function cancelTimeout() {
    const reason = byId('vball-correction-reason').value.trim();
    if (reason.length < 5) return setFeedback(controlFeedback, 'Enter a cancellation reason of at least 5 characters.', true);
    if (!await confirmAction({ title: 'Cancel this timeout?', message: `Cancellation will be recorded as a correction: ${reason}`, confirmLabel: 'CANCEL TIMEOUT' })) return;
    perform('timeout-cancel', () => window.bosAPI.volleyball.cancelTimeout(reason));
  }

  async function resolveTimeoutRecovery(choice) {
    let reason = '';
    if (choice !== 'resume') {
      reason = byId('vball-correction-reason').value.trim();
      if (reason.length < 5) return setFeedback(controlFeedback, 'Enter a recovery decision reason of at least 5 characters.', true);
      if (!await confirmAction({ title: 'Resolve interrupted timeout?', message: `Choose ${choice} and record: ${reason}`, confirmLabel: choice.toUpperCase() })) return;
    }
    perform('timeout-recovery', () => window.bosAPI.volleyball.resolveTimeoutRecovery(choice, reason));
  }

  async function resolveSidePrompt(action) {
    const confirmed = action !== 'switch' || await confirmAction({ title: 'Switch court sides?', message: 'The configured side-change prompt is pending. Only presentation positions will change.', confirmLabel: 'SWITCH SIDES' });
    if (!confirmed) return;
    perform('side-prompt', () => window.bosAPI.volleyball.resolveSideSwitchPrompt(action, {
      confirmed: action === 'switch',
      reason: `Operator chose ${action}`
    }));
  }

  function updateAnnouncementCounter() {
    const max = currentState && currentState.activeMatch ? currentState.activeMatch.rules.announcementMaxChars : 240;
    draft.maxLength = max;
    byId('vball-announcement-count').textContent = `${Array.from(draft.value).length} / ${max}`;
  }

  function updateAnnouncementControls() {
    byId('btn-vball-take-announcement-live').disabled = announcementSubmitting
      || requestInFlight
      || !draft.value.trim()
      || announcementPreviewRevision !== announcementDraftRevision;
  }

  function previewAnnouncement() {
    if (!draft.value.trim()) {
      setFeedback(controlFeedback, 'Enter announcement text before previewing.', true);
      byId('vball-announcement-preview').classList.add('hidden');
      return;
    }
    announcementPreviewRevision = announcementDraftRevision;
    byId('vball-announcement-preview-text').textContent = draft.value;
    byId('vball-announcement-preview').classList.remove('hidden');
    updateAnnouncementControls();
  }

  async function takeAnnouncementLive() {
    const button = byId('btn-vball-take-announcement-live');
    if (announcementSubmitting || button.disabled) return;
    if (!draft.value.trim()) return setFeedback(controlFeedback, 'Enter announcement text before taking it live.', true);
    if (announcementPreviewRevision !== announcementDraftRevision) {
      return setFeedback(controlFeedback, 'Preview the current announcement text before taking it live.', true);
    }
    const text = draft.value;
    const previewRevision = announcementPreviewRevision;
    announcementSubmitting = true;
    button.disabled = true;
    try {
      const confirmed = await confirmAction({ title: 'Take announcement live?', message: 'This publishes on-screen text to the Volleyball Browser Source only.', confirmLabel: 'TAKE LIVE' });
      if (!confirmed) return;
      if (previewRevision !== announcementDraftRevision || announcementPreviewRevision !== announcementDraftRevision || draft.value !== text) {
        setFeedback(controlFeedback, 'The draft changed after preview. Preview it again before publishing.', true);
        return;
      }
      const requestId = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      await perform('announcement-live', () => window.bosAPI.volleyball.setAnnouncementLive(text, requestId));
    } finally {
      announcementSubmitting = false;
      updateAnnouncementControls();
    }
  }

  async function clearAnnouncement() {
    const match = currentState && visibleMatch(currentState);
    const live = match && match.announcement.live;
    if (!live) return;
    if (!await confirmAction({ title: 'Clear Volleyball announcement?', message: 'This clears only the Volleyball announcement; Football graphics are unchanged.', confirmLabel: 'CLEAR ANNOUNCEMENT' })) return;
    perform('announcement-clear', () => window.bosAPI.volleyball.clearAnnouncement(live.id));
  }

  function correctSet() {
    const reason = byId('vball-correction-reason').value.trim();
    if (reason.length < 5) return setFeedback(controlFeedback, 'Enter a correction reason of at least 5 characters.', true);
    const match = currentState && currentState.activeMatch;
    if (!match || !correctionResultId) return;
    const setNumber = Number(byId('vball-correction-set').value);
    const points = {
      [match.homeTeamId]: Number(byId('vball-correction-home').value),
      [match.awayTeamId]: Number(byId('vball-correction-away').value)
    };
    confirmAction({ title: 'Save result correction?', message: `Apply the set correction: ${reason}`, confirmLabel: 'SAVE CORRECTION' }).then((ok) => {
      if (ok) perform('correct-set', () => window.bosAPI.volleyball.correctSetScore(setNumber, points, { reason, confirmed: true }));
    });
  }

  async function reopenResult(resultId) {
    const reason = byId('vball-correction-reason').value.trim();
    if (reason.length < 5) return setFeedback(controlFeedback, 'Enter a correction reason before reopening a result.', true);
    if (!await confirmAction({ title: 'Reopen completed match?', message: `The original result will be retained and marked superseded. ${reason}`, confirmLabel: 'REOPEN FOR CORRECTION' })) return;
    perform('reopen-result', () => window.bosAPI.volleyball.reopenCompletedMatch(resultId, { reason, confirmed: true }));
  }

  async function finalizeCorrection() {
    const reason = byId('vball-correction-reason').value.trim();
    if (reason.length < 5) return setFeedback(controlFeedback, 'Enter a final correction reason.', true);
    if (!await confirmAction({ title: 'Finalize corrected result?', message: reason, confirmLabel: 'FINALIZE RESULT' })) return;
    perform('finalize-correction', () => window.bosAPI.volleyball.finalizeCorrection({ reason, confirmed: true }));
  }

  function renderResults(state) {
    const list = byId('vball-completed-results');
    list.replaceChildren();
    state.completedResults.forEach((result) => {
      const item = document.createElement('li');
      const winner = result.teams[result.winnerTeamId];
      item.appendChild(document.createTextNode(`${result.matchName} · ${winner ? winner.name : 'Result'} · ${result.sets.map((set) => `${set.points[result.homeTeamId]}-${set.points[result.awayTeamId]}`).join(', ')}`));
      if (!result.supersededBy) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'CORRECT RESULT';
        button.addEventListener('click', () => reopenResult(result.id));
        item.appendChild(button);
      } else {
        const badge = document.createElement('span');
        badge.textContent = ' · SUPERSEDED';
        item.appendChild(badge);
      }
      list.appendChild(item);
    });
  }

  function renderCorrection(match) {
    const panel = byId('vball-correction-panel');
    const active = match && ['CORRECTION_REVIEW', 'CORRECTION_READY_TO_FINALIZE'].includes(match.status);
    panel.classList.toggle('hidden', !active);
    byId('btn-vball-finalize-correction').classList.toggle('hidden', !match || match.status !== 'CORRECTION_READY_TO_FINALIZE');
    if (!active) return;
    if (correctionResultId !== match.correctionOf) {
      correctionResultId = match.correctionOf;
      const select = byId('vball-correction-set');
      select.replaceChildren();
      match.sets.filter((set) => set.status === 'COMPLETE').forEach((set) => {
        const option = document.createElement('option');
        option.value = String(set.number);
        option.textContent = `Set ${set.number} · ${set.points[match.homeTeamId]}-${set.points[match.awayTeamId]}`;
        select.appendChild(option);
      });
    }
  }

  function render(state) {
    if (!state) return;
    currentState = state;
    const match = state.activeMatch || state.completedResults[state.completedResults.length - 1] || null;
    const storageError = state.storage && (state.storage.writesBlocked || state.storage.recoveryPersistenceError);
    byId('vball-control-status').textContent = storageError ? 'STORAGE RECOVERY REQUIRED' : match ? match.status.replace(/_/g, ' ') : 'NO MATCH';
    if (storageError) {
      const detail = state.storage.recoveryPersistenceError || 'Volleyball storage is read-only until the recovery issue is resolved.';
      setFeedback(controlFeedback, `Match controls are locked because storage recovery failed: ${detail}`, true);
    }
    byId('btn-volleyball-new-match').classList.toggle('hidden', !!state.activeMatch);
    if (!match) {
      byId('vball-live-competition').textContent = '';
      byId('vball-live-match-name').textContent = '';
      byId('vball-live-status').textContent = 'No match created';
      byId('vball-set-history').replaceChildren();
      renderResults(state);
      return;
    }

    const leftId = match.courtSides.leftTeamId;
    const rightId = match.courtSides.rightTeamId;
    const set = match.sets.find((entry) => entry.number === match.currentSetNumber) || match.sets[match.sets.length - 1];
    const setsWon = match.finalSetsWon || Object.fromEntries(Object.keys(match.teams).map((id) => [id,
      match.sets.filter((entry) => entry.status === 'COMPLETE' && entry.winnerTeamId === id).length
    ]));
    byId('vball-live-competition').textContent = match.competitionName;
    byId('vball-live-match-name').textContent = match.matchName;
    byId('vball-left-name').textContent = match.teams[leftId].name;
    byId('vball-right-name').textContent = match.teams[rightId].name;
    byId('vball-left-points').textContent = set ? String(set.points[leftId]) : '';
    byId('vball-right-points').textContent = set ? String(set.points[rightId]) : '';
    byId('vball-left-sets').textContent = `${setsWon[leftId] || 0} SETS`;
    byId('vball-right-sets').textContent = `${setsWon[rightId] || 0} SETS`;
    byId('vball-left-serving').classList.toggle('hidden', match.servingTeamId !== leftId);
    byId('vball-right-serving').classList.toggle('hidden', match.servingTeamId !== rightId);
    byId('vball-current-set').textContent = set ? `SET ${set.number} · TARGET ${set.target}` : 'FINAL';
    byId('vball-serving-team').textContent = `SERVING: ${match.teams[match.servingTeamId].name}`;
    byId('vball-live-status').textContent = match.status.replace(/_/g, ' ');
    byId('vball-live-timeout').textContent = match.activeTimeout ? `TIMEOUT ${match.activeTimeout.remainingSeconds}s` : '';
    byId('vball-control-title').textContent = `${match.competitionName} · ${match.matchName}`;

    const homeUsed = match.timeoutRecords.filter((timeout) => timeout.teamId === match.homeTeamId && timeout.status !== 'CANCELLED' && (match.rules.timeoutResetPolicy !== 'eachSet' || timeout.setNumber === match.currentSetNumber)).length;
    const awayUsed = match.timeoutRecords.filter((timeout) => timeout.teamId === match.awayTeamId && timeout.status !== 'CANCELLED' && (match.rules.timeoutResetPolicy !== 'eachSet' || timeout.setNumber === match.currentSetNumber)).length;
    byId('vball-home-timeouts').textContent = `${match.teams[match.homeTeamId].name} · ${homeUsed}/${match.rules.timeoutAllowance} used · ${Math.max(0, match.rules.timeoutAllowance - homeUsed)} left`;
    byId('vball-away-timeouts').textContent = `${match.teams[match.awayTeamId].name} · ${awayUsed}/${match.rules.timeoutAllowance} used · ${Math.max(0, match.rules.timeoutAllowance - awayUsed)} left`;
    byId('btn-vball-home-timeout').textContent = homeUsed >= match.rules.timeoutAllowance ? 'AUTHORIZED OVERRIDE' : 'CALL TIMEOUT';
    byId('btn-vball-away-timeout').textContent = awayUsed >= match.rules.timeoutAllowance ? 'AUTHORIZED OVERRIDE' : 'CALL TIMEOUT';
    byId('btn-vball-home-timeout').disabled = !!storageError || requestInFlight || !!match.activeTimeout || match.status !== 'SET_ACTIVE';
    byId('btn-vball-away-timeout').disabled = !!storageError || requestInFlight || !!match.activeTimeout || match.status !== 'SET_ACTIVE';
    byId('btn-vball-left-point').disabled = !!storageError || requestInFlight || match.status !== 'SET_ACTIVE' || !!match.activeTimeout || !!match.pendingSideSwitchPrompt;
    byId('btn-vball-right-point').disabled = byId('btn-vball-left-point').disabled;
    byId('btn-vball-switch-sides').disabled = !!storageError || requestInFlight || match.status === 'MATCH_COMPLETE' || !!match.pendingSideSwitchPrompt;
    byId('btn-vball-undo-point').disabled = !!storageError || requestInFlight;
    byId('btn-vball-undo-sides').disabled = !!storageError || requestInFlight;
    byId('btn-vball-start-match').classList.toggle('hidden', match.status !== 'READY');
    byId('btn-vball-record-set').classList.toggle('hidden', match.status !== 'SET_WON_PENDING_CONFIRMATION');
    byId('btn-vball-advance-set').classList.toggle('hidden', match.status !== 'BETWEEN_SETS');
    byId('vball-timeout-panel').classList.toggle('hidden', !match.activeTimeout || match.activeTimeout.status === 'RECOVERY_REVIEW');
    byId('vball-timeout-status').textContent = match.activeTimeout
      ? `${match.teams[match.activeTimeout.teamId].name} TIMEOUT · ${match.activeTimeout.status.replace(/_/g, ' ')} · ${match.activeTimeout.remainingSeconds}s`
      : '';
    byId('vball-recovery-panel').classList.toggle('hidden', !match.activeTimeout || match.activeTimeout.status !== 'RECOVERY_REVIEW');
    byId('vball-side-prompt').classList.toggle('hidden', !match.pendingSideSwitchPrompt);
    byId('vball-side-prompt-title').textContent = match.pendingSideSwitchPrompt && match.pendingSideSwitchPrompt.status === 'DEFERRED'
      ? 'SIDE CHANGE · DEFERRED'
      : 'SIDE CHANGE';
    byId('vball-side-prompt-reason').textContent = match.pendingSideSwitchPrompt ? match.pendingSideSwitchPrompt.reason : '';

    const history = byId('vball-set-history');
    history.replaceChildren();
    match.sets.forEach((entry) => {
      const item = document.createElement('li');
      const winner = entry.winnerTeamId ? match.teams[entry.winnerTeamId].name : 'No result';
      item.textContent = `Set ${entry.number} · ${entry.points[match.homeTeamId]}-${entry.points[match.awayTeamId]} · ${winner}`;
      history.appendChild(item);
    });
    renderCorrection(match);
    renderResults(state);
    updateAnnouncementCounter();
    byId('vball-announcement-live-state').textContent = match.announcement.live
      ? `LIVE · revision ${match.announcement.live.revision}`
      : 'No announcement live';
    byId('btn-vball-clear-announcement').disabled = !!storageError || !match.announcement.live || requestInFlight;
    updateAnnouncementControls();
  }

  return { init, openFromLanding };
})();
