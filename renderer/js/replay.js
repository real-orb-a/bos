// Replay Module — Source Record capture trigger
// BOS no longer records/generates/plays replays itself. The "Save Replay" button
// asks OBS to trigger the Source Record plugin's "Save Replay Buffer" hotkey via
// OBS WebSocket (TriggerHotkeyByName). Airing the saved file is a future phase.

window.ReplayModule = (function() {
  const statePill = document.getElementById('replay-state-pill');
  const requestDot = document.getElementById('replay-request-dot');
  const requestText = document.getElementById('replay-request-text');
  const requestDetail = document.getElementById('replay-request-detail');
  const sourceButtons = document.getElementById('replay-source-buttons');
  const btnSaveReplay = document.getElementById('btn-save-replay');

  function init() {
    bindEvents();
    loadStatus();
    listenIpc();
  }

  function bindEvents() {
    btnSaveReplay.addEventListener('click', () => {
      doCapture({});
    });
  }

  async function doCapture(options) {
    try {
      const result = await window.bosAPI.replay.capture(options);
      // The state event will already have re-rendered; fetch fresh status anyway.
      loadStatus();
      return result;
    } catch (e) {
      console.error('Error triggering replay save:', e);
      requestText.textContent = 'Replay trigger failed (see console)';
    }
  }

  async function loadStatus() {
    try {
      const status = await window.bosAPI.replay.getStatus();
      renderStatus(status);
    } catch (e) {
      console.error('Error loading replay status:', e);
    }
  }

  function renderStatus(status) {
    if (!status) return;
    const st = status.state || 'IDLE';

    // State pill
    statePill.textContent = st;
    statePill.className = 'replay-state-pill';
    if (st === 'TRIGGERING') statePill.classList.add('busy');
    else if (st === 'TRIGGERED') statePill.classList.add('ok');
    else if (st === 'ERROR') statePill.classList.add('error');

    // Status card
    requestDot.className = 'replay-request-dot';
    if (st === 'TRIGGERING') {
      requestDot.classList.add('busy');
      requestText.textContent = 'Saving Replay… (request sent to OBS)';
    } else if (st === 'TRIGGERED') {
      requestDot.classList.add('ok');
      requestText.textContent = 'Replay Triggered — Source Record is saving the buffer.';
    } else if (st === 'ERROR') {
      requestDot.classList.add('error');
      requestText.textContent = 'Could not trigger the Source Record hotkey.';
    } else {
      requestDot.classList.add('idle');
      requestText.textContent = status.enabled
        ? 'Ready — Source Record owns the replay buffer.'
        : 'Replay capture is disabled (replay.enabled = false).';
    }

    // Detail line
    if (status.lastError) {
      requestDetail.textContent = `Error: ${status.lastError}`;
    } else if (status.lastResult) {
      const r = status.lastResult;
      const when = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '';
      requestDetail.textContent = `${when} · hotkey=${r.hotkeyName}${r.contextName ? ' · context=' + r.contextName : ''}${r.sourceId ? ' · source=' + r.sourceId : ''}`;
    } else if (!status.enabled) {
      requestDetail.textContent = 'Enable it in Settings → OBS WebSocket → Source Record Replay Capture.';
    } else {
      requestDetail.textContent = 'No replay save requested yet.';
    }

    renderSourceButtons(status.sources || []);
  }

  function renderSourceButtons(sources) {
    if (!sources.length) {
      sourceButtons.innerHTML = '<div class="empty-queue-hint">No enabled capture sources (replay.captureSources).</div>';
      return;
    }
    sourceButtons.innerHTML = '';
    sources.forEach(src => {
      const btn = document.createElement('button');
      btn.className = 'replay-source-btn';
      btn.title = `${src.hotkeyName}${src.contextName ? ' · ' + src.contextName : ''}`;
      btn.innerHTML = `<span class="replay-source-dot"></span> SAVE ${src.name || src.id}`;
      btn.addEventListener('click', () => doCapture({ sourceId: src.id }));
      sourceButtons.appendChild(btn);
    });
  }

  function listenIpc() {
    window.bosAPI.replay.onStateChanged((status) => {
      renderStatus(status);
    });
  }

  return { init, doCapture };
})();