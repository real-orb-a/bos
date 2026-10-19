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
  window.BasketballModule.init();
  window.VolleyballModule.init();

  // Bind OBS controls
  btnObsReconnect.addEventListener('click', async () => {
    obsStatusIndicator.className = 'obs-status-indicator connecting';
    obsLabel.textContent = 'OBS CONNECTING…';
    try {
      updateObsStatusUI(await window.bosAPI.obs.connect());
    } catch (e) {
      console.warn('Reconnect error:', e);
      window.BOSUI.toast('Could not start the OBS connection attempt.', { type: 'error' });
    }
  });

  // Emergency Return to Live (Section 27)
  btnEmergencyAbort.addEventListener('click', returnToLive);

  // The backend always reports success; check the real OBS state before saying we are live.
  async function returnToLive() {
    try {
      await window.bosAPI.system.emergencyAbort();
      const status = await window.bosAPI.obs.getStatus();
      if (status && status.connected) {
        updateProgramStatus('LIVE');
      } else {
        window.BOSUI.toast('OBS is not connected, so the scene could not be switched. Graphics and the goal sequence were cleared.', { type: 'error' });
      }
    } catch (e) {
      console.error('Return to live failed:', e);
      window.BOSUI.toast('Return to live failed. Switch scenes in OBS directly.', { type: 'error' });
    }
  }

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
  // The four preview iframes each open a WebSocket and render a page, so they are only
  // loaded while the drawer is open, and use the configured graphics port.
  const previewFrames = Array.from(document.querySelectorAll('.preview-iframe'));
  let graphicsOrigin = 'http://localhost:8088';
  const browserSourcesUrl = document.getElementById('browser-sources-url');

  async function loadGraphicsOrigin() {
    try {
      const port = await window.bosAPI.config.get('graphics.httpPort');
      graphicsOrigin = `http://localhost:${Number(port) || 8088}`;
    } catch (e) {
      console.warn('Could not read graphics port, using 8088:', e);
    }
    browserSourcesUrl.textContent = `${graphicsOrigin}/graphics/...`;
  }

  function setPreviewsActive(active) {
    previewFrames.forEach((frame) => {
      if (active) {
        const wanted = graphicsOrigin + frame.dataset.srcPath;
        if (frame.getAttribute('src') !== wanted) frame.setAttribute('src', wanted);
      } else {
        frame.removeAttribute('src');
      }
    });
  }

  previewDrawerToggle.addEventListener('click', () => {
    const open = previewDrawerBody.classList.contains('hidden');
    previewDrawerBody.classList.toggle('hidden', !open);
    btnToggleDrawer.textContent = open ? '▼ HIDE PREVIEWS' : '▲ SHOW PREVIEWS';
    btnToggleDrawer.setAttribute('aria-expanded', String(open));
    setPreviewsActive(open);
  });
  await loadGraphicsOrigin();

  // Scene names are configurable; compare against the configured names, not literals.
  let liveSceneName = 'LIVE';
  let replaySceneName = 'REPLAY';
  async function loadSceneNames() {
    try {
      const scenes = await window.bosAPI.config.get('scenes');
      if (scenes && scenes.liveScene) liveSceneName = scenes.liveScene;
      if (scenes && scenes.replayScene) replaySceneName = scenes.replayScene;
    } catch (e) {
      console.warn('Could not read scene names, using defaults:', e);
    }
  }
  await loadSceneNames();
  window.addEventListener('bos:settings-saved', loadSceneNames);

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
    if (sceneName === replaySceneName) {
      updateProgramStatus('REPLAY');
    } else if (sceneName === liveSceneName) {
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
      obsLabel.textContent = 'OBS CONNECTED';
      if (status.currentScene) {
        currentSceneName.textContent = status.currentScene;
      }
    } else if (status.connecting) {
      obsStatusIndicator.className = 'obs-status-indicator connecting';
      obsLabel.textContent = 'OBS CONNECTING…';
    } else {
      obsStatusIndicator.className = 'obs-status-indicator disconnected';
      obsLabel.textContent = 'OBS DISCONNECTED';
      obsPing.textContent = '-- ms';
      // Say why, when OBS told us (full explanation in the tooltip).
      const reason = status.lastError;
      if (reason) {
        const shortReasons = {
          AUTH_FAILED: 'WRONG PASSWORD',
          UNREACHABLE: 'NOT REACHABLE',
          HOST_NOT_FOUND: 'HOST NOT FOUND',
          TIMEOUT: 'NO RESPONSE',
          VERSION_MISMATCH: 'BAD VERSION',
          CONNECTION_LOST: 'CONNECTION LOST'
        };
        const shortText = shortReasons[reason.category];
        if (shortText) obsLabel.textContent = `OBS DISCONNECTED — ${shortText}`;
        obsStatusIndicator.title = reason.message;
      }
    }
    if (status.connected || status.connecting) {
      obsStatusIndicator.title = '';
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
  // Codes we acted on at keydown; their keyup is cancelled so a focused button or
  // <summary> does not ALSO activate (e.g. Space toggling the clock and re-clicking a button).
  const handledCodes = new Set();

  window.addEventListener('keydown', (e) => {
    if (e.repeat || Date.now() < keyboardShortcutsReadyAt) return;

    // Leave browser/OS shortcuts alone (Ctrl+R must not save a replay).
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // No live shortcuts while a dialog is open (typing in Settings must never fire a goal).
    if (window.BOSUI.isModalOpen()) return;
    if (document.body.dataset.view !== 'control-room') return;

    // Avoid triggering when user is typing in an input
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      return;
    }

    const code = e.code;
    let handled = true;

    // Team-specific score keys (configured in Teams & Branding).
    if (window.MatchModule.handleGoalHotkey(code)) {
      // handled by MatchModule
    }
    // R: Save Replay (trigger Source Record hotkey)
    else if (code === 'KeyR') {
      window.ReplayModule.doCapture({});
    }
    // L: Emergency Return to Live
    else if (code === 'KeyL') {
      returnToLive();
    }
    // U: Under Review (Quick)
    else if (code === 'KeyU') {
      window.bosAPI.graphics.showLowerThird({
        title: 'UNDER REVIEW',
        subtitle: 'DECISION PENDING',
        duration: 6,
        style: 'alert',
        position: 'bottom-left'
      });
    }
    // H: Hide Lower Third
    else if (code === 'KeyH') {
      window.bosAPI.graphics.hideLowerThird();
    }
    // Space: Start/Pause Match Clock
    else if (code === 'Space') {
      window.bosAPI.match.clockToggle();
    } else {
      handled = false;
    }

    if (handled) {
      e.preventDefault();
      handledCodes.add(code);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (handledCodes.delete(e.code)) e.preventDefault();
  });

  console.log('[BOS] App initialized and hotkeys registered.');
});
