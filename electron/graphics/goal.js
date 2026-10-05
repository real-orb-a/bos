class GoalGraphicsController {
  constructor(configManager) {
    this.config = configManager;
  }

  getPayload(team, scoreState, options = {}) {
    const isHome = team.toLowerCase() === 'home' || team.toUpperCase() === 'GARNET';
    const teamData = isHome ? scoreState.home : scoreState.away;

    return {
      type: 'GOAL_ANIMATION',
      team: {
        name: teamData.name,
        short: teamData.short,
        color: teamData.color,
        secondaryColor: teamData.secondaryColor,
        score: teamData.score
      },
      player: options.player || '',
      assist: options.assist || '',
      duration: options.duration || this.config.get('goalWorkflow.goalAnimationDuration') || 3.0,
      timestamp: Date.now()
    };
  }
}

module.exports = GoalGraphicsController;
