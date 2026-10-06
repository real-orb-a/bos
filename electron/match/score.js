const EventEmitter = require('events');

class ScoreManager extends EventEmitter {
  constructor(configManager) {
    super();
    this.config = configManager;
    const teams = this.config.get('teams') || {};
    this.home = {
      name: teams.home?.name || 'GARNET',
      short: teams.home?.short || 'GAR',
      color: teams.home?.color || '#e11d48',
      secondaryColor: teams.home?.secondaryColor || '#7f1d1d',
      score: teams.home?.score || 0,
      logo: teams.home?.logo || ''
    };
    this.away = {
      name: teams.away?.name || 'TOPAZ',
      short: teams.away?.short || 'TOP',
      color: teams.away?.color || '#eab308',
      secondaryColor: teams.away?.secondaryColor || '#713f12',
      score: teams.away?.score || 0,
      logo: teams.away?.logo || ''
    };
  }

  getScore() {
    return {
      home: { ...this.home },
      away: { ...this.away }
    };
  }

  addHome(amount = 1) {
    const prev = this.home.score;
    this.home.score = Math.max(0, this.home.score + amount);
    this._persist();
    this.emit('scoreChanged', { team: 'home', prev, current: this.home.score, state: this.getScore() });
    return this.getScore();
  }

  subtractHome(amount = 1) {
    return this.addHome(-amount);
  }

  addAway(amount = 1) {
    const prev = this.away.score;
    this.away.score = Math.max(0, this.away.score + amount);
    this._persist();
    this.emit('scoreChanged', { team: 'away', prev, current: this.away.score, state: this.getScore() });
    return this.getScore();
  }

  subtractAway(amount = 1) {
    return this.addAway(-amount);
  }

  setScore(homeScore, awayScore) {
    const prevHome = this.home.score;
    const prevAway = this.away.score;
    this.home.score = Math.max(0, parseInt(homeScore, 10) || 0);
    this.away.score = Math.max(0, parseInt(awayScore, 10) || 0);
    this._persist();
    this.emit('scoreChanged', {
      team: 'both',
      prev: { home: prevHome, away: prevAway },
      current: { home: this.home.score, away: this.away.score },
      state: this.getScore()
    });
    return this.getScore();
  }

  resetScore() {
    return this.setScore(0, 0);
  }

  updateTeams(teamsData) {
    if (teamsData.home) {
      this.home = { ...this.home, ...teamsData.home };
    }
    if (teamsData.away) {
      this.away = { ...this.away, ...teamsData.away };
    }
    this._persist();
    this.emit('teamsUpdated', this.getScore());
    return this.getScore();
  }

  _persist() {
    this.config.set('teams.home', this.home);
    this.config.set('teams.away', this.away);
  }
}

module.exports = ScoreManager;
