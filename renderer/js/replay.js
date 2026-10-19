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
  let triggerResetTimer = null;

  function init() {
    bindEvents();
    loadStatus();
    listenIpc();
  }

  function bindEvents() {
    btnSaveReplay.addEventListener('click', () => {
        doCapture({ all: true });
    });
  }

  async function doCapture(options) {
    try {
      const result = options && options.all
        ? await window.bosAPI.replay.captureAll()
        : await window.bosAPI.replay.capture(options);
      // The state event will already have re-rendered; fetch fresh status anyway.
      loadStatus();
      return result;
    } catch (e) {
      console.error('Error triggering replay save:', e);
      requestText.textContent = 'Replay trigger failed (see console)';
      window.BOSUI.toast('The replay save request failed. Check the OBS connection.', { type: 'error' });
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
    const lastTriggeredAt = status.lastTriggeredAt || (status.lastResult && status.lastResult.timestamp);
    const lastTriggeredText = lastTriggeredAt
      ? `LAST TRIGGERED ${new Date(lastTriggeredAt).toLocaleTimeString()}`
      : 'LAST TRIGGERED NEVER';

    // State pill
    statePill.textContent = st;
    statePill.className = 'replay-state-pill';
    if (st === 'TRIGGERING') statePill.classList.add('busy');
    else if (st === 'TRIGGERED') statePill.classList.add('ok');
    else if (st === 'ERROR') statePill.classList.add('error');

    requestDot.className = 'replay-request-dot';
    if (st === 'TRIGGERING') {
      clearTimeout(triggerResetTimer);
      triggerResetTimer = null;
      requestDot.classList.add('busy');
      requestText.textContent = 'SAVING REPLAY';
      requestDetail.textContent = lastTriggeredText;
    } else if (st === 'TRIGGERED') {
      requestDot.classList.add('ok');
      requestText.textContent = 'REPLAY TRIGGERED';
      requestDetail.textContent = lastTriggeredText;
      if (!triggerResetTimer) {
        triggerResetTimer = setTimeout(() => {
          triggerResetTimer = null;
          renderStatus({ ...status, state: 'IDLE' });
        }, 1600);
      }
    } else if (st === 'ERROR') {
      requestDot.classList.add('error');
      requestText.textContent = 'REPLAY TRIGGER FAILED';
      requestDetail.textContent = status.lastError || lastTriggeredText;
    } else {
      requestDot.classList.add('idle');
      requestText.textContent = status.enabled ? 'READY' : 'REPLAY CAPTURE DISABLED';
      requestDetail.textContent = lastTriggeredText;
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
      btn.type = 'button';
      const dot = document.createElement('span');
      dot.className = 'replay-source-dot';
      btn.append(dot, document.createTextNode(` SAVE ${src.name || src.id}`));
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