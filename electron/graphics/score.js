class ScoreGraphicsController {
  constructor(scoreManager, matchEngine) {
    this.score = scoreManager;
    this.match = matchEngine;
  }

  getPayload(animationType = 'update', changedTeam = null) {
    const scoreState = this.score.getScore();
    const clockState = this.match.getClockState();

    return {
      type: 'SCORE_UPDATE',
      home: scoreState.home,
      away: scoreState.away,
      clock: clockState,
      sets: this.match.getSetState(),
      animation: animationType, // 'flip', 'pop', 'flash', 'update'
      changedTeam,
      timestamp: Date.now()
    };
  }
}

module.exports = ScoreGraphicsController;
