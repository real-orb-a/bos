(() => {
  const scoreboard = document.getElementById('scoreboard');
  const announcement = document.getElementById('announcement');
  const announcementText = document.getElementById('announcement-text');
  const leftName = document.getElementById('left-name');
  const rightName = document.getElementById('right-name');
  const leftPoints = document.getElementById('left-points');
  const rightPoints = document.getElementById('right-points');
  const leftSets = document.getElementById('left-sets');
  const rightSets = document.getElementById('right-sets');
  const leftServing = document.getElementById('left-serving');
  const rightServing = document.getElementById('right-serving');
  const timeoutLabel = document.getElementById('timeout-label');
  let latestStateRevision = -1;
  let latestAnnouncementRevision = -1;
  let liveAnnouncementId = null;

  function renderState(snapshot) {
    if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < latestStateRevision) return;
    latestStateRevision = snapshot.revision;
    if (!snapshot.teams || !snapshot.courtSides) {
      scoreboard.classList.add('hidden');
      renderAnnouncement(snapshot.announcement || null, snapshot.announcementRevision || 0);
      return;
    }

    const leftId = snapshot.courtSides.leftTeamId;
    const rightId = snapshot.courtSides.rightTeamId;
    const leftTeam = snapshot.teams[leftId];
    const rightTeam = snapshot.teams[rightId];
    if (!leftTeam || !rightTeam || !snapshot.currentPoints || !snapshot.setsWon) {
      scoreboard.classList.add('hidden');
      return;
    }

    leftName.textContent = leftTeam.name;
    rightName.textContent = rightTeam.name;
    leftPoints.textContent = String(snapshot.currentPoints[leftId] ?? 0);
    rightPoints.textContent = String(snapshot.currentPoints[rightId] ?? 0);
    leftSets.textContent = `${snapshot.setsWon[leftId] ?? 0} SETS`;
    rightSets.textContent = `${snapshot.setsWon[rightId] ?? 0} SETS`;
    leftServing.classList.toggle('hidden', snapshot.servingTeamId !== leftId);
    rightServing.classList.toggle('hidden', snapshot.servingTeamId !== rightId);
    document.getElementById('competition-name').textContent = snapshot.competitionName || '';
    document.getElementById('match-name').textContent = snapshot.matchName || '';
    document.getElementById('set-label').textContent = snapshot.currentSetNumber
      ? `SET ${snapshot.currentSetNumber} · TARGET ${snapshot.currentSetTarget}`
      : 'FINAL RESULT';
    document.getElementById('match-status').textContent = String(snapshot.status || '').replace(/_/g, ' ');
    const timeout = snapshot.activeTimeout;
    if (timeout) {
      const team = snapshot.teams[timeout.teamId];
      const remaining = timeout.status === 'TIMER_ELAPSED_AWAITING_OPERATOR'
        ? 'TIMER ELAPSED · AWAITING OPERATOR'
        : timeout.status === 'RECOVERY_REVIEW'
          ? 'TIMEOUT RECOVERY REVIEW'
          : `TIMEOUT · ${Math.max(0, timeout.remainingSeconds)}s`;
      timeoutLabel.textContent = `${team ? team.name : 'TEAM'} · ${remaining}`;
      timeoutLabel.classList.remove('hidden');
    } else {
      timeoutLabel.textContent = '';
      timeoutLabel.classList.add('hidden');
    }
    scoreboard.classList.remove('hidden');
    renderAnnouncement(snapshot.announcement || null, snapshot.announcementRevision || 0);
  }

  function renderAnnouncement(data, revision) {
    if (!Number.isSafeInteger(revision) || revision < latestAnnouncementRevision) return;
    latestAnnouncementRevision = revision;
    if (!data || typeof data.text !== 'string') {
      liveAnnouncementId = null;
      announcementText.textContent = '';
      announcement.classList.add('hidden');
      return;
    }
    if (data.revision < latestAnnouncementRevision) return;
    liveAnnouncementId = data.id;
    announcementText.textContent = data.text;
    announcement.classList.remove('hidden');
  }

  function connect() {
    const socket = new WebSocket(`ws://${location.hostname || 'localhost'}:${location.port || 8088}/ws`);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'INITIAL_SYNC') {
          latestStateRevision = -1;
          if (message.volleyball) renderState(message.volleyball);
        } else if (message.type === 'VOLLEYBALL_STATE_UPDATE') {
          renderState(message.data);
        } else if (message.type === 'VOLLEYBALL_ANNOUNCEMENT_SHOW') {
          const revision = message.data && message.data.revision;
          if (Number.isSafeInteger(revision) && revision >= latestAnnouncementRevision) {
            latestAnnouncementRevision = revision;
            liveAnnouncementId = message.data.id;
            announcementText.textContent = message.data.text;
            announcement.classList.remove('hidden');
          }
        } else if (message.type === 'VOLLEYBALL_ANNOUNCEMENT_CLEAR') {
          if (Number.isSafeInteger(message.revision) && message.revision >= latestAnnouncementRevision) {
            latestAnnouncementRevision = message.revision;
            liveAnnouncementId = null;
            announcementText.textContent = '';
            announcement.classList.add('hidden');
          }
        }
      } catch (error) {
        console.error('[VolleyballGraphics] Invalid graphics message:', error.message);
      }
    };
    socket.onclose = () => setTimeout(connect, 2000);
    socket.onerror = () => socket.close();
  }

  connect();
})();
