class BasketballGraphicsController {
  constructor(basketballEngine) {
    this.basketball = basketballEngine;
  }

  getSnapshot(state = this.basketball.getState()) {
    const match = state.match;
    if (!match) return { revision: state.revision, status: 'NO_MATCH', home: null, away: null, clock: null, announcement: null };
    return {
      revision: state.revision,
      status: match.status,
      competitionName: match.competitionName,
      matchName: match.matchName,
      home: { ...match.teams.home },
      away: { ...match.teams.away },
      clock: {
        formatted: match.clock,
        period: match.period > match.periodCount ? 'FINAL' : `Q${match.period}`,
        shotClock: match.shotClock,
        running: match.clockRunning
      },
      announcement: match.announcement.live,
      announcementRevision: match.announcement.revision
    };
  }
}

module.exports = BasketballGraphicsController;
