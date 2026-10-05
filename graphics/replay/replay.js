(function() {
  const overlay = document.getElementById('replay-overlay');
  const speedEl = document.getElementById('replay-speed');
  const cameraEl = document.getElementById('replay-camera');
  const titleEl = document.getElementById('replay-title');
  const progressFill = document.getElementById('progress-fill');

  let durationSeconds = 8;
  let startTime = 0;
  let progressInterval = null;

  function showReplay(data) {
    if (!data) return;
    speedEl.textContent = data.speed || '1×';
    if (data.camera) {
      cameraEl.textContent = data.camera;
      cameraEl.style.display = 'inline-flex';
    } else {
      cameraEl.textContent = '';
      cameraEl.style.display = 'none';
    }
    titleEl.textContent = data.title || 'HIGHLIGHT';
    durationSeconds = data.duration || 8;
    startTime = Date.now();

    progressFill.style.width = '0%';
    overlay.classList.remove('hidden');

    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min(100, (elapsed / durationSeconds) * 100);
      progressFill.style.width = `${pct}%`;
      if (pct >= 100) {
        clearInterval(progressInterval);
      }
    }, 50);
  }

  function hideReplay() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    progressFill.style.width = '0%';
    overlay.classList.add('hidden');
  }

  function connectWebSocket() {
    const wsUrl = `ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INITIAL_SYNC') {
          if (msg.replayOverlay && msg.replayOverlay.active && msg.replayOverlay.data) {
            showReplay(msg.replayOverlay.data);
          }
        } else if (msg.type === 'REPLAY_OVERLAY_SHOW') {
          showReplay(msg.data);
        } else if (msg.type === 'REPLAY_OVERLAY_HIDE') {
          hideReplay();
        }
      } catch (err) {
        console.error('[ReplayGraphic] Parse error:', err);
      }
    };

    ws.onclose = () => setTimeout(connectWebSocket, 2000);
  }

  connectWebSocket();
})();
