// Settings & Configuration Management Module
window.SettingsModule = (function() {
  const modal = document.getElementById('settings-modal');
  const btnOpen = document.getElementById('btn-open-settings');
  const btnClose = document.getElementById('btn-close-settings');
  const btnCancel = document.getElementById('btn-cancel-settings');
  const btnSave = document.getElementById('btn-save-settings');

  const tabButtons = modal.querySelectorAll('.tab-btn');
  const tabPanes = modal.querySelectorAll('.tab-pane');

  // OBS + Source Record inputs
  const cfgObsHost = document.getElementById('cfg-obs-host');
  const cfgObsPort = document.getElementById('cfg-obs-port');
  const cfgObsPassword = document.getElementById('cfg-obs-password');
  const cfgSceneLive = document.getElementById('cfg-scene-live');
  const cfgSceneReplay = document.getElementById('cfg-scene-replay');
  const cfgMediaSource = document.getElementById('cfg-media-source');
  const cfgReplayEnabled = document.getElementById('cfg-replay-enabled');
  const cfgReplaySources = document.getElementById('cfg-replay-sources');
  const btnAddReplaySource = document.getElementById('btn-add-replay-source');

  const cfgHomeGoalAction = document.getElementById('cfg-home-goal-action');
  const cfgAwayGoalAction = document.getElementById('cfg-away-goal-action');

  // Goal workflow
  const cfgGoalAnim = document.getElementById('cfg-goal-anim');
  const cfgCelebrationDur = document.getElementById('cfg-celebration-dur');
  const cfgCaptureReplay = document.getElementById('cfg-capture-replay');
  const cfgReplaySourceId = document.getElementById('cfg-replay-source-id');

  function init() {
    bindEvents();
  }

  function bindEvents() {
    btnOpen.addEventListener('click', () => {
      loadFormData();
      modal.classList.remove('hidden');
    });

    btnClose.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    btnCancel.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetPane = document.getElementById(btn.dataset.tab);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    btnSave.addEventListener('click', () => {
      saveFormData();
    });

    btnAddReplaySource.addEventListener('click', () => {
      const sources = collectReplaySources();
      const usedIds = new Set(sources.map(source => source.id));
      let nextNumber = sources.length + 1;
      while (usedIds.has(`camera-${nextNumber}`)) nextNumber++;
      sources.push({
        id: `camera-${nextNumber}`,
        name: `Camera ${nextNumber}`,
        enabled: true,
        hotkeyName: '',
        contextName: ''
      });
      renderReplaySources(sources);
    });

  }

  async function loadFormData() {
    try {
      const config = await window.bosAPI.config.get();
      if (!config) return;

      if (config.obs) {
        cfgObsHost.value = config.obs.host || 'localhost';
        cfgObsPort.value = config.obs.port || 4455;
        cfgObsPassword.value = config.obs.password || '';
      }

      if (config.scenes) {
        cfgSceneLive.value = config.scenes.liveScene || 'LIVE';
        cfgSceneReplay.value = config.scenes.replayScene || 'REPLAY';
        cfgMediaSource.value = config.scenes.replayMediaSource || 'Replay Video';
      }

      if (config.replay) {
        cfgReplayEnabled.checked = config.replay.enabled !== false;
        renderReplaySources(config.replay.captureSources || []);
      }

      if (config.goalWorkflow) {
        cfgGoalAnim.checked = !!config.goalWorkflow.showGoalAnimation;
        cfgCelebrationDur.value = config.goalWorkflow.celebrationDurationSeconds || 3.0;
        cfgCaptureReplay.checked = !!config.goalWorkflow.captureReplayOnGoal;
        cfgReplaySourceId.value = config.goalWorkflow.replaySourceId || '';
        cfgHomeGoalAction.value = config.goalWorkflow.homeGoalActionLabel || 'GOAL';
        cfgAwayGoalAction.value = config.goalWorkflow.awayGoalActionLabel || 'GOAL';
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  async function saveFormData() {
    // Merge with the current replay config so changing the trigger settings doesn't
    // wipe the per-source hotkey definitions (replay.captureSources).
    const currentConfig = await window.bosAPI.config.get() || {};
    const currentReplay = currentConfig.replay || {};

    const newConfig = {
      obs: {
        host: cfgObsHost.value.trim(),
        port: parseInt(cfgObsPort.value, 10) || 4455,
        password: cfgObsPassword.value,
        autoReconnect: true,
        reconnectIntervalMs: 3000
      },
      scenes: {
        liveScene: cfgSceneLive.value.trim() || 'LIVE',
        replayScene: cfgSceneReplay.value.trim() || 'REPLAY',
        graphicsScene: 'GRAPHICS',
        replayMediaSource: cfgMediaSource.value.trim() || 'Replay Video'
      },
      replay: {
        ...currentReplay,
        enabled: cfgReplayEnabled.checked,
        captureSources: collectReplaySources()
      },
      goalWorkflow: {
        ...(currentConfig.goalWorkflow || {}),
        showGoalAnimation: cfgGoalAnim.checked,
        goalAnimationDuration: 3.0,
        celebrationDurationSeconds: parseFloat(cfgCelebrationDur.value) || 3.0,
        captureReplayOnGoal: cfgCaptureReplay.checked,
        replaySourceId: cfgReplaySourceId.value.trim(),
        homeGoalActionLabel: cfgHomeGoalAction.value.trim().toUpperCase() || 'GOAL',
        awayGoalActionLabel: cfgAwayGoalAction.value.trim().toUpperCase() || 'GOAL',
        autoReturnLive: true
      }
    };

    try {
      await window.bosAPI.config.updateAll(newConfig);
      window.goalActionLabels = {
        home: newConfig.goalWorkflow.homeGoalActionLabel,
        away: newConfig.goalWorkflow.awayGoalActionLabel
      };
      window.MatchModule.refreshGoalLabels();
      modal.classList.add('hidden');
      alert('Settings saved successfully!');
    } catch (e) {
      console.error('Failed to save settings:', e);
      alert('Error saving settings: ' + e.message);
    }
  }

  function renderReplaySources(sources) {
    cfgReplaySources.innerHTML = '';
    if (!sources.length) {
      cfgReplaySources.innerHTML = '<div class="empty-queue-hint">No camera triggers configured.</div>';
      return;
    }

    sources.forEach((source, index) => {
      const row = document.createElement('div');
      row.className = 'replay-source-config-row';
      row.innerHTML = `
        <label>CAMERA ID<input type="text" data-field="id"></label>
        <label>DISPLAY NAME<input type="text" data-field="name"></label>
        <label>HOTKEY NAME<input type="text" data-field="hotkeyName" placeholder="ReplayBuffer.Save"></label>
        <label>CONTEXT NAME<input type="text" data-field="contextName" placeholder="OBS Source Record context"></label>
        <div class="replay-source-config-actions">
          <label class="replay-source-enabled"><input type="checkbox" data-field="enabled"> ENABLED</label>
          <button type="button" class="replay-source-remove">REMOVE</button>
        </div>
      `;
      row.querySelector('[data-field="id"]').value = source.id || '';
      row.querySelector('[data-field="name"]').value = source.name || '';
      row.querySelector('[data-field="hotkeyName"]').value = source.hotkeyName || '';
      row.querySelector('[data-field="contextName"]').value = source.contextName || '';
      row.querySelector('[data-field="enabled"]').checked = source.enabled !== false;
      row.querySelector('.replay-source-remove').addEventListener('click', () => {
        const currentSources = collectReplaySources();
        currentSources.splice(index, 1);
        renderReplaySources(currentSources);
      });
      cfgReplaySources.appendChild(row);
    });
  }

  function collectReplaySources() {
    return Array.from(cfgReplaySources.querySelectorAll('.replay-source-config-row'))
      .map(row => ({
        id: row.querySelector('[data-field="id"]').value.trim(),
        name: row.querySelector('[data-field="name"]').value.trim(),
        enabled: row.querySelector('[data-field="enabled"]').checked,
        hotkeyName: row.querySelector('[data-field="hotkeyName"]').value.trim(),
        contextName: row.querySelector('[data-field="contextName"]').value.trim()
      }))
      .filter(source => source.id && source.name);
  }

  return { init };
})();