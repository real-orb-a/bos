(() => {
  const scoreboard = document.getElementById('scoreboard');
  const announcement = document.getElementById('announcement');
  const announcementText = document.getElementById('announcement-text');
  const homeName = document.getElementById('home-name');
  const awayName = document.getElementById('away-name');
  const homeScore = document.getElementById('home-score');
  const awayScore = document.getElementById('away-score');
  const clockOutput = document.getElementById('clock-display');
  const periodOutput = document.getElementById('period-display');
  const shotClock = document.getElementById('shot-clock');

  function updateScoreboard(data) {
    if (!data) return;

    const home = data.home || data.teams?.home || {};
    const away = data.away || data.teams?.away || {};

    if (home.name) homeName.textContent = String(home.name).toUpperCase();
    if (away.name) awayName.textContent = String(away.name).toUpperCase();

    homeScore.textContent = String(home.score ?? 0);
    awayScore.textContent = String(away.score ?? 0);

    const displayedClock = data.clock || data.matchClock || {};
    if (displayedClock.formatted) clockOutput.textContent = displayedClock.formatted;
    if (displayedClock.period) periodOutput.textContent = String(displayedClock.period).toUpperCase();
    if (displayedClock.shotClock !== undefined) shotClock.textContent = String(displayedClock.shotClock);

    scoreboard.classList.remove('hidden');
  }

  function updateAnnouncement(entry) {
    if (!entry || typeof entry.text !== 'string') {
      announcementText.textContent = '';
      announcement.classList.add('hidden');
      return;
    }
    announcementText.textContent = entry.text;
    announcement.classList.remove('hidden');
  }

  function connect() {
    const socket = new WebSocket(`ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`);

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'INITIAL_SYNC') {
          if (message.basketball) {
            if (message.basketball.status === 'NO_MATCH') scoreboard.classList.add('hidden');
            else {
              updateScoreboard(message.basketball);
            }
            updateAnnouncement(message.basketball.announcement);
          }
        } else if (message.type === 'BASKETBALL_STATE_UPDATE') {
          const data = message.data || message;
          updateScoreboard(data);
          updateAnnouncement(data.announcement);
        } else if (message.type === 'BASKETBALL_ANNOUNCEMENT_SHOW') {
          updateAnnouncement(message.data || message);
        } else if (message.type === 'BASKETBALL_ANNOUNCEMENT_CLEAR') {
          updateAnnouncement(null);
        }
      } catch (error) {
        console.error('[BasketballGraphics] Invalid message:', error.message);
      }
    };

    socket.onclose = () => setTimeout(connect, 2000);
    socket.onerror = () => socket.close();
  }

  connect();
})();
