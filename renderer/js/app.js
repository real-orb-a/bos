// Master App Coordinator Module
document.addEventListener('DOMContentLoaded', async () => {
  const obsStatusIndicator = document.getElementById('obs-status-indicator');
  const obsLabel = document.getElementById('obs-label');
  const obsPing = document.getElementById('obs-ping');
  const btnObsReconnect = document.getElementById('btn-obs-reconnect');

  const currentSceneName = document.getElementById('current-scene-name');
  const currentTransitionInfo = document.getElementById('current-transition-info');
  const programStatusBadge = document.getElementById('program-status-badge');
  const programDot = document.getElementById('program-dot');
  const programText = document.getElementById('program-text');

  const activeSequenceBar = document.getElementById('active-sequence-bar');
  const seqTitle = document.getElementById('seq-title');
  const seqStepPill = document.getElementById('seq-step-pill');
  const btnAbortSequence = document.getElementById('btn-abort-sequence');
  const btnContinueSequence = document.getElementById('btn-continue-sequence');

  const btnEmergencyAbort = document.getElementById('btn-emergency-abort');

  // Preview Drawer
  const previewDrawerToggle = document.getElementById('preview-drawer-toggle');
  const previewDrawerBody = document.getElementById('preview-drawer-body');
  const btnToggleDrawer = document.getElementById('btn-toggle-drawer');

  // Initialize Submodules
  window.MatchModule.init();
  window.GraphicsModule.init();
  window.ReplayModule.init();
  window.SettingsModule.init();

  // Bind OBS controls
  btnObsReconnect.addEventListener('click', async () => {
    obsLabel.textContent = 'CONNECTING...';
    try {
      await window.bosAPI.obs.connect();
    } catch (e) {
      console.warn('Reconnect error:', e);
    }
  });

  // Emergency Return to Live (Section 27)
  btnEmergencyAbort.addEventListener('click', async () => {
    await window.bosAPI.system.emergencyAbort();
    updateProgramStatus('LIVE');
  });

  // Sequence Abort
  btnAbortSequence.addEventListener('click', async () => {
    await window.bosAPI.workflow.abort();
    activeSequenceBar.classList.add('hidden');
    updateProgramStatus('LIVE');
  });

  btnContinueSequence.addEventListener('click', async () => {
    btnContinueSequence.disabled = true;
    try {
      await window.bosAPI.workflow.continueToLive();
    } finally {
      btnContinueSequence.disabled = false;
    }
  });

  // Preview Drawer Toggle
  previewDrawerToggle.addEventListener('click', () => {
    const isHidden = previewDrawerBody.classList.contains('hidden');
    if (isHidden) {
      previewDrawerBody.classList.remove('hidden');
      btnToggleDrawer.textContent = '▼ HIDE PREVIEWS';
    } else {
      previewDrawerBody.classList.add('hidden');
      btnToggleDrawer.textContent = '▲ SHOW PREVIEWS';
    }
  });

  // Initial OBS status
  try {
    const status = await window.bosAPI.obs.getStatus();
    updateObsStatusUI(status);

    const currentTrans = await window.bosAPI.obs.getCurrentTransition();
    if (currentTrans) {
      currentTransitionInfo.textContent = `${currentTrans.name.toUpperCase()} (${currentTrans.duration}ms)`;
    }
  } catch (e) {
    console.error('Error fetching initial OBS status:', e);
  }

  // Listen to OBS Events
  window.bosAPI.obs.onStatusChanged((status) => {
    updateObsStatusUI(status);
  });

  window.bosAPI.obs.onSceneChanged((sceneName) => {
    currentSceneName.textContent = sceneName;
    if (sceneName === 'REPLAY') {
      updateProgramStatus('REPLAY');
    } else if (sceneName === 'LIVE') {
      updateProgramStatus('LIVE');
    }
  });

  window.bosAPI.obs.onPing((latency) => {
    obsPing.textContent = `${latency} ms`;
  });

  // Workflow Events
  window.bosAPI.workflow.onStarted((wf) => {
    activeSequenceBar.classList.remove('hidden');
    btnContinueSequence.classList.add('hidden');
    seqTitle.textContent = `AUTOMATED GOAL SEQUENCE: ${wf.team.toUpperCase()} GOAL`;
    seqStepPill.textContent = 'INITIATING';
    updateProgramStatus('GOAL');
  });

  window.bosAPI.workflow.onStep((data) => {
    seqStepPill.textContent = data.step.replace(/_/g, ' ');
    btnContinueSequence.classList.toggle('hidden', data.step !== 'WAITING_FOR_GO_AHEAD');
  });

  window.bosAPI.workflow.onCompleted(() => {
    activeSequenceBar.classList.add('hidden');
    btnContinueSequence.classList.add('hidden');
    updateProgramStatus('LIVE');
  });

  window.bosAPI.workflow.onAborted(() => {
    activeSequenceBar.classList.add('hidden');
    btnContinueSequence.classList.add('hidden');
    updateProgramStatus('LIVE');
  });

  // Match Temp State
  window.bosAPI.match.onTempStateChanged((state) => {
    if (state.tempState === 'REPLAY' || state.tempState === 'SLOW_MOTION') {
      updateProgramStatus('REPLAY');
    } else if (state.tempState === 'GOAL') {
      updateProgramStatus('GOAL');
    } else if (state.tempState === 'NONE') {
      updateProgramStatus('LIVE');
    }
  });

  function updateObsStatusUI(status) {
    if (!status) return;

    if (status.connected) {
      obsStatusIndicator.className = 'obs-status-indicator connected';
      obsLabel.textContent = 'OBS ● CONNECTED';
      if (status.currentScene) {
        currentSceneName.textContent = status.currentScene;
      }
    } else if (status.connecting) {
      obsStatusIndicator.className = 'obs-status-indicator';
      obsLabel.textContent = 'OBS ● CONNECTING...';
    } else {
      obsStatusIndicator.className = 'obs-status-indicator disconnected';
      obsLabel.textContent = 'OBS ● DISCONNECTED';
      obsPing.textContent = '-- ms';
    }
  }

  function updateProgramStatus(statusType) {
    programStatusBadge.className = 'program-monitor-badge';
    if (statusType === 'REPLAY') {
      programStatusBadge.classList.add('replay');
      programText.textContent = 'PROGRAM: REPLAY ON AIR';
    } else if (statusType === 'GOAL') {
      programStatusBadge.classList.add('goal');
      programText.textContent = 'PROGRAM: GOAL ANIMATION';
    } else {
      programText.textContent = 'PROGRAM: LIVE';
    }
  }

  // --- Keyboard Shortcuts (Section 28) ---
  const keyboardShortcutsReadyAt = Date.now() + 1500;
  window.addEventListener('keydown', (e) => {
    if (e.repeat || Date.now() < keyboardShortcutsReadyAt) return;

    // Avoid triggering when user is typing in an input
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return;
    }

    const code = e.code;

    // Team-specific score keys (configured in Teams & Branding).
    if (window.MatchModule.handleGoalHotkey(code)) {
      e.preventDefault();
    }
    // R: Save Replay (trigger Source Record hotkey)
    else if (code === 'KeyR' && !e.defaultPrevented) {
      e.preventDefault();
      window.ReplayModule.doCapture({});
    }
    // L: Emergency Return to Live
    else if (code === 'KeyL' && !e.defaultPrevented) {
      e.preventDefault();
      window.bosAPI.system.emergencyAbort();
      updateProgramStatus('LIVE');
    }
    // U: Under Review (Quick)
    else if (code === 'KeyU' && !e.defaultPrevented) {
      e.preventDefault();
      window.bosAPI.graphics.showLowerThird({
        title: 'UNDER REVIEW',
        subtitle: 'DECISION PENDING',
        duration: 6,
        style: 'alert',
        position: 'bottom-left'
      });
    }
    // H: Hide Lower Third
    else if (code === 'KeyH' && !e.defaultPrevented) {
      e.preventDefault();
      window.bosAPI.graphics.hideLowerThird();
    }
    // Space: Start/Pause Match Clock
    else if (code === 'Space' && !e.defaultPrevented) {
      e.preventDefault();
      window.bosAPI.match.clockToggle();
    }
  });

  console.log('[BOS] App initialized and hotkeys registered.');
});
