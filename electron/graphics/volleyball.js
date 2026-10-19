class VolleyballGraphicsController {
  constructor(volleyballEngine) {
    this.volleyball = volleyballEngine;
  }

  getSnapshot(state = this.volleyball.getState()) {
    const match = state.activeMatch || state.completedResults[state.completedResults.length - 1] || null;
    if (!match) {
      return {
        revision: state.revision,
        status: 'NO_MATCH',
        teams: null,
        sets: [],
        courtSides: null,
        servingTeamId: null,
        activeTimeout: null,
        pendingSideSwitchPrompt: null,
        announcement: null
      };
    }

    const home = match.teams[match.homeTeamId];
    const away = match.teams[match.awayTeamId];
    const set = match.sets.find((entry) => entry.number === match.currentSetNumber) || null;
    const timeout = match.activeTimeout;
    const currentTimeout = timeout && !['ENDED', 'CANCELLED'].includes(timeout.status)
      ? {
        id: timeout.id,
        teamId: timeout.teamId,
        status: timeout.status,
        remainingSeconds: timeout.remainingSeconds || 0,
        timerElapsedAt: timeout.timerElapsedAt || null
      }
      : null;
    const countTimeouts = (teamId) => {
      const matching = match.timeoutRecords.filter((entry) => {
        if (entry.teamId !== teamId || entry.status === 'CANCELLED') return false;
        return match.rules.timeoutResetPolicy !== 'eachSet' || entry.setNumber === match.currentSetNumber;
      }).length;
      return {
        used: matching,
        allowance: match.rules.timeoutAllowance,
        remaining: Math.max(0, match.rules.timeoutAllowance - matching)
      };
    };

    return {
      revision: state.revision,
      matchId: match.id,
      competitionName: match.competitionName,
      matchName: match.matchName,
      status: match.status,
      currentSetNumber: match.currentSetNumber,
      currentSetTarget: set ? set.target : null,
      currentPoints: set ? { ...set.points } : null,
      setsWon: match.finalSetsWon || {
        [match.homeTeamId]: match.sets.filter((entry) => entry.status === 'COMPLETE' && entry.winnerTeamId === match.homeTeamId).length,
        [match.awayTeamId]: match.sets.filter((entry) => entry.status === 'COMPLETE' && entry.winnerTeamId === match.awayTeamId).length
      },
      setsToWin: match.setsToWin,
      teams: {
        [match.homeTeamId]: { id: home.id, name: home.name, timeouts: countTimeouts(match.homeTeamId) },
        [match.awayTeamId]: { id: away.id, name: away.name, timeouts: countTimeouts(match.awayTeamId) }
      },
      courtSides: { ...match.courtSides },
      servingTeamId: match.servingTeamId,
      sets: match.sets.map((entry) => ({
        number: entry.number,
        target: entry.target,
        points: { ...entry.points },
        status: entry.status,
        winnerTeamId: entry.winnerTeamId || null,
        completedAt: entry.completedAt || null
      })),
      activeTimeout: currentTimeout,
      pendingSideSwitchPrompt: match.pendingSideSwitchPrompt ? { ...match.pendingSideSwitchPrompt } : null,
      announcement: match.announcement.live ? { ...match.announcement.live } : null,
      announcementRevision: match.announcement.revision,
      winnerTeamId: match.winnerTeamId || null,
      completedAt: match.completedAt || null
    };
  }
}

module.exports = VolleyballGraphicsController;
