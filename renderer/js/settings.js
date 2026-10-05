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
  const cfgReplayHotkey = document.getElementById('cfg-replay-hotkey');
  const cfgReplayContext = document.getElementById('cfg-replay-context');

  // Teams
  const cfgTeamHomeName = document.getElementById('cfg-team-home-name');
  const cfgTeamHomeShort = document.getElementById('cfg-team-home-short');
  const cfgTeamHomeColor = document.getElementById('cfg-team-home-color');
  const cfgTeamAwayName = document.getElementById('cfg-team-away-name');
  const cfgTeamAwayShort = document.getElementById('cfg-team-away-short');
  const cfgTeamAwayColor = document.getElementById('cfg-team-away-color');

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
        cfgReplayHotkey.value = config.replay.hotkeyName || 'ReplayBuffer.Save';
        cfgReplayContext.value = config.replay.contextName || '';
      }

      if (config.teams) {
        cfgTeamHomeName.value = config.teams.home?.name || 'GARNET';
        cfgTeamHomeShort.value = config.teams.home?.short || 'GAR';
        cfgTeamHomeColor.value = config.teams.home?.color || '#e11d48';

        cfgTeamAwayName.value = config.teams.away?.name || 'TOPAZ';
        cfgTeamAwayShort.value = config.teams.away?.short || 'TOP';
        cfgTeamAwayColor.value = config.teams.away?.color || '#0284c7';
      }

      if (config.goalWorkflow) {
        cfgGoalAnim.checked = !!config.goalWorkflow.showGoalAnimation;
        cfgCelebrationDur.value = config.goalWorkflow.celebrationDurationSeconds || 3.0;
        cfgCaptureReplay.checked = config.goalWorkflow.captureReplayOnGoal !== false;
        cfgReplaySourceId.value = config.goalWorkflow.replaySourceId || '';
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
        hotkeyName: cfgReplayHotkey.value.trim() || 'ReplayBuffer.Save',
        contextName: cfgReplayContext.value.trim()
      },
      teams: {
        home: {
          name: cfgTeamHomeName.value.trim().toUpperCase(),
          short: cfgTeamHomeShort.value.trim().toUpperCase(),
          color: cfgTeamHomeColor.value
        },
        away: {
          name: cfgTeamAwayName.value.trim().toUpperCase(),
          short: cfgTeamAwayShort.value.trim().toUpperCase(),
          color: cfgTeamAwayColor.value
        }
      },
      goalWorkflow: {
        showGoalAnimation: cfgGoalAnim.checked,
        goalAnimationDuration: 3.0,
        celebrationDurationSeconds: parseFloat(cfgCelebrationDur.value) || 3.0,
        captureReplayOnGoal: cfgCaptureReplay.checked,
        replaySourceId: cfgReplaySourceId.value.trim(),
        autoReturnLive: true
      }
    };

    try {
      await window.bosAPI.config.updateAll(newConfig);
      await window.bosAPI.score.updateTeams(newConfig.teams);
      modal.classList.add('hidden');
      alert('Settings saved successfully!');
    } catch (e) {
      console.error('Failed to save settings:', e);
      alert('Error saving settings: ' + e.message);
    }
  }

  return { init };
})();