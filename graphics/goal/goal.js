(function() {
  const container = document.getElementById('goal-container');
  const teamTitle = document.getElementById('team-title');
  const playerName = document.getElementById('player-name');
  const scoreTag = document.getElementById('score-tag');
  const teamStripe = document.getElementById('team-stripe');
  const goalCard = document.getElementById('goal-card');

  let hideTimeout = null;

  function showGoal(data) {
    if (!data) return;

    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    const team = data.team || {};
    teamTitle.textContent = team.name || 'TEAM';
    playerName.textContent = data.player || 'GOAL CELEBRATION';
    scoreTag.textContent = `${team.name || 'TEAM'} ${team.score !== undefined ? team.score : ''}`;

    const color = team.color || '#e11d48';
    teamStripe.style.backgroundColor = color;
    teamStripe.style.boxShadow = `0 0 30px ${color}`;
    goalCard.style.boxShadow = `0 25px 60px rgba(0, 0, 0, 0.8), 0 0 40px ${color}80`;

    container.classList.remove('hidden');
    // Reflow
    void container.offsetWidth;
    container.classList.add('active');

    const durationMs = (data.duration || 3.0) * 1000;
    hideTimeout = setTimeout(() => {
      container.classList.remove('active');
      setTimeout(() => {
        container.classList.add('hidden');
      }, 400);
    }, durationMs);
  }

  function connectWebSocket() {
    const wsUrl = `ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'GOAL_ANIMATION') {
          showGoal(msg);
        }
      } catch (err) {
        console.error('[GoalGraphic] Parse error:', err);
      }
    };

    ws.onclose = () => setTimeout(connectWebSocket, 2000);
  }

  connectWebSocket();
})();
