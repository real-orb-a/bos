const EventEmitter = require('events');
const { randomUUID } = require('crypto');

const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => new Error(message);

function name(value, label, maxLength = 48) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > maxLength) {
    throw fail(`${label} must contain 1 to ${maxLength} characters.`);
  }
  return value.trim();
}

class BasketballEngine extends EventEmitter {
  constructor(store, options = {}) {
    super();
    if (!store || typeof store.getData !== 'function' || typeof store.save !== 'function') {
      throw new TypeError('A BasketballStore-compatible store is required.');
    }
    this.store = store;
    this.now = options.now || (() => Date.now());
    this.makeId = options.makeId || (() => randomUUID());
    this.data = this.store.getData();
    this.timer = null;
    this.lastError = null;
    if (this.data.match && this.data.match.clockRunning) {
      this.data.match.clockRunning = false;
      this.data.match.clockAnchor = null;
      try {
        this._commit((candidate) => { candidate.match.clockRunning = false; });
      } catch (error) {
        console.error('[Basketball] Could not persist the stopped clock during recovery:', error.message);
      }
    }
  }

  _settleClock(match, now = this.now()) {
    if (!match.clockRunning || match.clockAnchor === null) return;
    const elapsed = Math.max(0, now - match.clockAnchor);
    match.gameClockMs = Math.max(0, match.gameClockMs - elapsed);
    match.shotClockMs = Math.max(0, match.shotClockMs - elapsed);
    match.clockAnchor = now;
    if (match.gameClockMs === 0 || match.shotClockMs === 0) {
      match.clockRunning = false;
      match.clockAnchor = null;
      match.status = match.gameClockMs === 0 ? 'PERIOD_END' : 'SHOT_CLOCK';
    }
  }

  getState() {
    const state = clone(this.data);
    const match = state.match;
    if (match && match.clockRunning && match.clockAnchor !== null) {
      const elapsed = Math.max(0, this.now() - match.clockAnchor);
      match.gameClockMs = Math.max(0, match.gameClockMs - elapsed);
      match.shotClockMs = Math.max(0, match.shotClockMs - elapsed);
    }
    if (match) {
      match.clock = this._formatClock(match.gameClockMs);
      match.shotClock = Math.ceil(match.shotClockMs / 1000);
    }
    state.storage = this.getStatus();
    return state;
  }

  getStatus() {
    return { ...this.store.getStatus(), lastError: this.lastError };
  }

  _formatClock(milliseconds) {
    const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  _publish() {
    const state = this.getState();
    for (const listener of this.rawListeners('changed')) {
      try { listener.call(this, state); } catch (error) {
        console.error('[Basketball] changed listener failed after commit:', error.message);
      }
    }
  }

  _commit(mutator) {
    if (this.store.getStatus().writesBlocked) throw fail('Basketball storage is read-only until its recovery problem is resolved.');
    const candidate = clone(this.data);
    mutator(candidate);
    candidate.revision = this.data.revision + 1;
    try {
      this.store.save(candidate);
      this.lastError = null;
    } catch (error) {
      this.lastError = error.message;
      throw error;
    }
    this.data = candidate;
    this._syncTimer();
    this._publish();
    return this.getState();
  }

  _syncTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.data.match && this.data.match.clockRunning) {
      this.timer = setInterval(() => this._tick(), 100);
    }
  }

  _tick() {
    const match = this.data.match;
    if (!match || !match.clockRunning || match.clockAnchor === null) return;
    const now = this.now();
    const elapsed = Math.max(0, now - match.clockAnchor);
    if (elapsed < 1000) return;
    try {
      this._commit((candidate) => {
        const current = candidate.match;
        current.gameClockMs = Math.max(0, current.gameClockMs - elapsed);
        current.shotClockMs = Math.max(0, current.shotClockMs - elapsed);
        current.clockAnchor = now;
        if (current.gameClockMs === 0 || current.shotClockMs === 0) {
          current.clockRunning = false;
          current.clockAnchor = null;
          current.status = current.gameClockMs === 0 ? 'PERIOD_END' : 'SHOT_CLOCK';
        }
      });
    } catch (error) {
      match.clockRunning = false;
      match.clockAnchor = null;
      this._syncTimer();
      console.error('[Basketball] Clock stopped because match state could not be saved:', error.message);
      this._publish();
    }
  }

  createMatch(setup) {
    if (!setup || typeof setup !== 'object') throw fail('Basketball match setup is required.');
    const homeName = name(setup.homeTeamName, 'Home team');
    const awayName = name(setup.awayTeamName, 'Away team');
    if (homeName.toLocaleLowerCase() === awayName.toLocaleLowerCase()) throw fail('Team names must be different.');
    const periodCount = setup.periodCount === undefined ? 4 : setup.periodCount;
    const periodMinutes = setup.periodMinutes === undefined ? 10 : setup.periodMinutes;
    const shotClockSeconds = setup.shotClockSeconds === undefined ? 24 : setup.shotClockSeconds;
    if (!Number.isInteger(periodCount) || periodCount < 2 || periodCount > 8) throw fail('Periods must be a whole number from 2 to 8.');
    if (!Number.isInteger(periodMinutes) || periodMinutes < 1 || periodMinutes > 30) throw fail('Period length must be 1 to 30 minutes.');
    if (!Number.isInteger(shotClockSeconds) || shotClockSeconds < 1 || shotClockSeconds > 60) throw fail('Shot clock must be 1 to 60 seconds.');
    return this._commit((candidate) => {
      const teamId = () => this.makeId();
      const homeId = teamId();
      const awayId = teamId();
      candidate.match = {
        id: this.makeId(),
        competitionName: name(setup.competitionName, 'Competition', 80),
        matchName: name(setup.matchName, 'Match', 80),
        createdAt: this.now(),
        status: 'READY',
        periodCount,
        periodMinutes,
        shotClockSeconds,
        period: 1,
        gameClockMs: periodMinutes * 60_000,
        shotClockMs: shotClockSeconds * 1000,
        clockRunning: false,
        clockAnchor: null,
        timeoutActive: null,
        timeoutReturnStatus: null,
        teams: {
          home: { id: homeId, name: homeName, score: 0, fouls: 0, timeouts: 0 },
          away: { id: awayId, name: awayName, score: 0, fouls: 0, timeouts: 0 }
        },
        history: [],
        announcement: { revision: 0, live: null }
      };
    });
  }

  toggleClock() {
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match) throw fail('Create a Basketball match before operating the clock.');
      if (match.status === 'FINAL') throw fail('The Basketball match is final.');
      if (match.clockRunning) {
        this._settleClock(match);
        if (match.clockRunning) {
          match.clockRunning = false;
          match.clockAnchor = null;
          match.status = 'PAUSED';
        }
        return;
      }
      if (match.timeoutActive) throw fail('End the active timeout before starting the game clock.');
      if (match.gameClockMs <= 0) throw fail('Set the game clock before starting it.');
      if (match.shotClockMs <= 0) throw fail('Reset the shot clock before starting the game clock.');
      match.clockRunning = true;
      match.clockAnchor = this.now();
      match.status = 'LIVE';
    });
  }

  setClock(seconds) {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) throw fail('Game clock must be 0 to 3600 whole seconds.');
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match) throw fail('Create a Basketball match before setting the clock.');
      this._settleClock(match);
      match.gameClockMs = seconds * 1000;
      if (match.clockRunning) match.clockAnchor = this.now();
      if (seconds === 0) {
        match.clockRunning = false;
        match.clockAnchor = null;
        match.status = 'PERIOD_END';
      } else if (match.status === 'PERIOD_END' && match.shotClockMs > 0) {
        match.status = 'PAUSED';
      }
    });
  }

  setPeriod(period) {
    if (!Number.isInteger(period) || period < 1 || period > 8) throw fail('Period must be a whole number from 1 to 8.');
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match) throw fail('Create a Basketball match before changing period.');
      match.clockRunning = false;
      match.clockAnchor = null;
      match.timeoutActive = null;
      match.timeoutReturnStatus = null;
      match.period = period;
      match.gameClockMs = match.periodMinutes * 60_000;
      match.shotClockMs = match.shotClockSeconds * 1000;
      match.status = period > match.periodCount ? 'FINAL' : 'PAUSED';
    });
  }

  addScore(side, points) {
    if (!['home', 'away'].includes(side) || !Number.isInteger(points) || ![1, 2, 3].includes(points)) {
      throw fail('Choose a team and a score value of 1, 2, or 3.');
    }
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match || match.status === 'FINAL') throw fail('A live Basketball match is required to change the score.');
      if (match.timeoutActive) throw fail('End the active timeout before changing the score.');
      match.teams[side].score += points;
      match.history.push({ type: 'score', side, points, at: this.now() });
      if (match.history.length > 500) match.history.shift();
    });
  }

  adjustScore(side, delta) {
    if (!['home', 'away'].includes(side) || !Number.isInteger(delta) || ![-3, -2, -1, 1, 2, 3].includes(delta)) {
      throw fail('Score adjustment must be one, two, or three points.');
    }
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match || match.status === 'FINAL') throw fail('A live Basketball match is required to change the score.');
      if (match.timeoutActive) throw fail('End the active timeout before changing the score.');
      const team = match.teams[side];
      team.score = Math.max(0, team.score + delta);
      match.history.push({ type: 'adjustment', side, points: delta, at: this.now() });
      if (match.history.length > 500) match.history.shift();
    });
  }

  addFoul(side) {
    if (!['home', 'away'].includes(side)) throw fail('Choose a team to record the foul.');
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match || match.status === 'FINAL') throw fail('A live Basketball match is required to record a foul.');
      if (match.timeoutActive) throw fail('End the active timeout before recording a foul.');
      match.teams[side].fouls++;
    });
  }

  callTimeout(side) {
    if (!['home', 'away'].includes(side)) throw fail('Choose a team to call timeout.');
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match || match.status === 'FINAL') throw fail('A live Basketball match is required to call timeout.');
      if (match.timeoutActive) throw fail('End the active timeout before calling another timeout.');
      match.timeoutReturnStatus = match.status;
      match.timeoutActive = side;
      match.teams[side].timeouts++;
      this._settleClock(match);
      match.clockRunning = false;
      match.clockAnchor = null;
      match.status = 'TIMEOUT';
    });
  }

  endTimeout() {
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match || !match.timeoutActive) throw fail('There is no active Basketball timeout.');
      match.timeoutActive = null;
      match.status = match.timeoutReturnStatus === 'READY' ? 'READY'
        : match.gameClockMs === 0 ? 'PERIOD_END'
          : match.shotClockMs === 0 ? 'SHOT_CLOCK' : 'PAUSED';
      match.timeoutReturnStatus = null;
    });
  }

  setShotClock(seconds) {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 60) throw fail('Shot clock must be 0 to 60 whole seconds.');
    return this._commit((candidate) => {
      const match = candidate.match;
      if (!match) throw fail('Create a Basketball match before setting the shot clock.');
      this._settleClock(match);
      match.shotClockMs = seconds * 1000;
      if (match.clockRunning) match.clockAnchor = this.now();
      if (seconds === 0) {
        match.clockRunning = false;
        match.clockAnchor = null;
        match.status = match.gameClockMs === 0 ? 'PERIOD_END' : 'SHOT_CLOCK';
      } else if (match.status === 'SHOT_CLOCK') {
        match.status = match.clockRunning ? 'LIVE' : 'PAUSED';
      }
    });
  }

  setAnnouncement(text) {
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 240) {
      throw fail('Announcement must contain 1 to 240 characters.');
    }
    return this._commit((candidate) => {
      if (!candidate.match) throw fail('Create a Basketball match before publishing an announcement.');
      const announcement = candidate.match.announcement;
      announcement.revision++;
      announcement.live = { id: this.makeId(), revision: announcement.revision, text: text.trim() };
    });
  }

  clearAnnouncement(id) {
    return this._commit((candidate) => {
      if (!candidate.match) throw fail('Create a Basketball match before clearing its announcement.');
      const announcement = candidate.match.announcement;
      if (!announcement.live) throw fail('There is no live Basketball announcement to clear.');
      if (id && announcement.live.id !== id) throw fail('The live Basketball announcement changed. Refresh before clearing it.');
      announcement.revision++;
      announcement.live = null;
    });
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = BasketballEngine;
