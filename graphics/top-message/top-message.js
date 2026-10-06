(function() {
  const tm = document.getElementById('top-message');
  const titleEl = document.getElementById('tm-title');
  const subtitleEl = document.getElementById('tm-subtitle');
  const badgeText = document.getElementById('badge-text');
  const valueEl = document.getElementById('tm-value');
  let hideTimeout = null;

  function showTopMessage(data) {
    if (!data) return;

    titleEl.textContent = data.title || 'BROADCAST MESSAGE';
    subtitleEl.textContent = data.subtitle || '';
    subtitleEl.style.display = data.subtitle ? 'block' : 'none';

    // Right-hand highlight block: small label (badge) + big accent value.
    badgeText.textContent = data.style === 'alert' ? 'OFFICIAL NOTICE' : (data.badge || 'BROADCAST');
    valueEl.textContent = data.value || '';

    // House colour accent drives the accent stripe, title and highlight value.
    const accent = data.color || '';
    if (accent) document.documentElement.style.setProperty('--tm-accent', accent);

    // Reset classes, then normalise the position: shared form data may arrive as
    // bottom-* (lower-third positions) — map those to the top zone, defaulting
    // to top-center like the race-control banner.
    tm.className = 'top-message';
    let pos = data.position || 'top-center';
    pos = pos.replace(/^bottom-/, 'top-');
    if (pos !== 'top-left' && pos !== 'top-center' && pos !== 'top-right') {
      pos = 'top-center';
    }
    tm.classList.add(pos);
    if (data.style) tm.classList.add(`style-${data.style}`);

    // Force reflow and reveal (transition handles the slide-in)
    void tm.offsetWidth;
    tm.classList.remove('hidden');

    if (hideTimeout) clearTimeout(hideTimeout);
    const durationMs = (data.duration || 5) * 1000;
    if (durationMs > 0) {
      hideTimeout = setTimeout(() => {
        tm.classList.add('hidden');
      }, durationMs);
    }
  }

  function hideTopMessage() {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    tm.classList.add('hidden');
  }

  function connectWebSocket() {
    const wsUrl = `ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INITIAL_SYNC') {
          if (msg.topMessage && msg.topMessage.active && msg.topMessage.data) {
            showTopMessage(msg.topMessage.data);
          }
        } else if (msg.type === 'TOP_MESSAGE_SHOW') {
          showTopMessage(msg.data);
        } else if (msg.type === 'TOP_MESSAGE_HIDE') {
          hideTopMessage();
        }
      } catch (err) {
        console.error('[TopMessage] Parse error:', err);
      }
    };

    ws.onclose = () => setTimeout(connectWebSocket, 2000);
  }

  connectWebSocket();
})();
