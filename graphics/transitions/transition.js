(function() {
  const container = document.getElementById('transition-container');
  const badgeTitle = document.getElementById('badge-title');
  let ws = null;
  let activeTransitionId = null;

  function startTransition(data = {}) {
    activeTransitionId = data.id || `trans_${Date.now()}`;
    const title = data.title || 'REPLAY';
    badgeTitle.textContent = title;

    // House colours (Garnet / Emerald / Topaz …) or a custom brand colour.
    const accent = data.color || '';
    const accent2 = data.color2 || '';
    document.documentElement.style.setProperty('--tw-accent', accent);
    document.documentElement.style.setProperty('--tw-accent2', accent2 || accent);

    container.className = 'transition-container hidden';
    void container.offsetWidth; // force reflow
    container.className = 'transition-container playing';

    // Broadcast covered point (Section 22 & 23: ~500ms is full coverage)
    setTimeout(() => {
      sendWsEvent({
        type: 'TRANSITION_COVERED',
        transitionId: activeTransitionId,
        timestamp: Date.now()
      });
    }, 500);

    // Broadcast complete point (1100ms)
    setTimeout(() => {
      sendWsEvent({
        type: 'TRANSITION_FINISHED',
        transitionId: activeTransitionId,
        timestamp: Date.now()
      });
      container.className = 'transition-container hidden';
    }, 1100);
  }

  function sendWsEvent(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function connectWebSocket() {
    const wsUrl = `ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'TRIGGER_TRANSITION') {
          startTransition(msg.data);
        }
      } catch (err) {
        console.error('[Transition] Parse error:', err);
      }
    };

    ws.onclose = () => setTimeout(connectWebSocket, 2000);
  }

  connectWebSocket();
})();
