const EventEmitter = require('events');

const MatchStates = {
  PRE_MATCH: 'PRE_MATCH',
  LIVE: 'LIVE',
  HALF_TIME: 'HALF_TIME',
  LIVE_SECOND_HALF: 'LIVE_SECOND_HALF',
  FULL_TIME: 'FULL_TIME',
  BREAK: 'BREAK',
  DELAYED: 'DELAYED',
  UNDER_REVIEW: 'UNDER_REVIEW'
};

const TemporaryStates = {
  NONE: 'NONE',
  GOAL: 'GOAL',
  REPLAY: 'REPLAY',
  SLOW_MOTION: 'SLOW_MOTION',
  GRAPHIC_ACTIVE: 'GRAPHIC_ACTIVE'
};

class MatchEngine extends EventEmitter {
  constructor(scoreManager, eventLogger, configManager) {
    super();
    this.score = scoreManager;
    this.events = eventLogger;
    this.config = configManager;

    this.state = MatchStates.PRE_MATCH;
    this.tempState = TemporaryStates.NONE;
    this.isSequenceRunning = false;
    this.activeSequenceName = null;

    // Clock state
    this.clockRunning = false;
    this.elapsedSeconds = 0;
    this.period = '1st Half';
    this.stoppageTimeMinutes = 0;
    this.clockInterval = null;

    this._startClockTick();
  }

  _startClockTick() {
    this.clockInterval = setInterval(() => {
      if (this.clockRunning) {
        this.elapsedSeconds++;
        this.emit('clockTick', this.getClockState());
      }
    }, 1000);
  }

  getClockState() {
    const mins = Math.floor(this.elapsedSeconds / 60);
    const secs = this.elapsedSeconds % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return {
      running: this.clockRunning,
      elapsedSeconds: this.elapsedSeconds,
      formatted,
      period: this.period,
      stoppageTime: this.stoppageTimeMinutes > 0 ? `+${this.stoppageTimeMinutes}` : ''
    };
  }

  startClock() {
    this.clockRunning = true;
    this.events.recordEvent('CLOCK_START', { time: this.getClockState().formatted });
    this.emit('clockChanged', this.getClockState());
  }

  pauseClock() {
    this.clockRunning = false;
    this.events.recordEvent('CLOCK_PAUSE', { time: this.getClockState().formatted });
    this.emit('clockChanged', this.getClockState());
  }

  toggleClock() {
    if (this.clockRunning) {
      this.pauseClock();
    } else {
      this.startClock();
    }
    return this.getClockState();
  }

  resetClock() {
    this.elapsedSeconds = 0;
    this.events.recordEvent('CLOCK_RESET');
    this.emit('clockChanged', this.getClockState());
  }

  setClock(seconds, period, stoppageMinutes) {
    if (seconds !== undefined) this.elapsedSeconds = Math.max(0, parseInt(seconds, 10));
    if (period !== undefined) this.period = period;
    if (stoppageMinutes !== undefined) this.stoppageTimeMinutes = Math.max(0, parseInt(stoppageMinutes, 10));
    this.emit('clockChanged', this.getClockState());
  }

  setPeriod(period) {
    this.period = period;
    if (period === '1st Half') {
      this.elapsedSeconds = 0;
    } else if (period === '2nd Half') {
      this.elapsedSeconds = 45 * 60;
    } else if (period === 'Extra Time') {
      this.elapsedSeconds = 90 * 60;
    }
    this.events.recordEvent('PERIOD_CHANGED', { period });
    this.emit('clockChanged', this.getClockState());
  }

  setMatchState(newState) {
    if (!MatchStates[newState]) {
      console.warn(`[MatchEngine] Invalid match state: ${newState}`);
      return false;
    }
    const previous = this.state;
    this.state = newState;
    this.events.recordEvent('MATCH_STATE_CHANGED', { from: previous, to: newState });
    this.emit('stateChanged', { from: previous, current: newState, state: this.getFullState() });
    return true;
  }

  setTemporaryState(tempState, sequenceName = null) {
    this.tempState = tempState;
    if (tempState !== TemporaryStates.NONE) {
      this.isSequenceRunning = true;
      this.activeSequenceName = sequenceName || tempState;
    } else {
      this.isSequenceRunning = false;
      this.activeSequenceName = null;
    }
    this.emit('temporaryStateChanged', {
      tempState: this.tempState,
      sequenceRunning: this.isSequenceRunning,
      activeSequence: this.activeSequenceName
    });
  }

  canStartSequence(sequenceName, force = false) {
    if (this.isSequenceRunning && !force) {
      return {
        allowed: false,
        reason: `Cannot start "${sequenceName}": Sequence "${this.activeSequenceName}" is currently active.`
      };
    }
    return { allowed: true };
  }

  getFullState() {
    return {
      matchState: this.state,
      tempState: this.tempState,
      isSequenceRunning: this.isSequenceRunning,
      activeSequenceName: this.activeSequenceName,
      clock: this.getClockState(),
      score: this.score.getScore()
    };
  }

  destroy() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }
}

MatchEngine.States = MatchStates;
MatchEngine.TemporaryStates = TemporaryStates;

module.exports = MatchEngine;
