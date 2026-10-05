(function() {
  const lt = document.getElementById('lower-third');
  const titleEl = document.getElementById('lt-title');
  const subtitleEl = document.getElementById('lt-subtitle');
  const badgeText = document.getElementById('badge-text');

  function showLowerThird(data) {
    if (!data) return;

    titleEl.textContent = data.title || 'BROADCAST MESSAGE';
    subtitleEl.textContent = data.subtitle || '';
    if (!data.subtitle) {
      subtitleEl.style.display = 'none';
    } else {
      subtitleEl.style.display = 'block';
    }

    badgeText.textContent = data.style === 'alert' ? 'OFFICIAL NOTICE' : (data.badge || 'BROADCAST');

    // Reset positions and styles
    lt.className = 'lower-third';
    const pos = data.position || 'bottom-left';
    lt.classList.add(pos);

    if (data.style) {
      lt.classList.add(`style-${data.style}`);
    }

    // Force reflow and remove hidden
    void lt.offsetWidth;
    lt.classList.remove('hidden');
  }

  function hideLowerThird() {
    lt.classList.add('hidden');
  }

  function connectWebSocket() {
    const wsUrl = `ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INITIAL_SYNC') {
          if (msg.lowerThird && msg.lowerThird.isVisible && msg.lowerThird.currentData) {
            showLowerThird(msg.lowerThird.currentData);
          }
        } else if (msg.type === 'LOWER_THIRD_SHOW') {
          showLowerThird(msg.data);
        } else if (msg.type === 'LOWER_THIRD_HIDE') {
          hideLowerThird();
        }
      } catch (err) {
        console.error('[LowerThird] Parse error:', err);
      }
    };

    ws.onclose = () => setTimeout(connectWebSocket, 2000);
  }

  connectWebSocket();
})();
