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
    //   timerMode 'stopwatch' counts UP to the regulation ("set") time — football style.
    //   timerMode 'countdown' counts DOWN to 00:00 — basketball-style timing.
    //   Once the set time is reached, if additional (stoppage) time has been set the
    //   main clock FREEZES at the set time and a "+M:SS" overlay below it counts the
    //   added time until the allotted stoppage is used up, then the clock stops.
    this.clockRunning = false;
    this.elapsedSeconds = 0;
    this.period = '1st Half';
    this.stoppageTimeMinutes = 0;    // allotted additional time in minutes (N)
    this.stoppageElapsedSeconds = 0; // additional time consumed so far (seconds)
    this.inStoppage = false;
    this.timerMode = this.config.get('match.timerMode') === 'countdown' ? 'countdown' : 'stopwatch';
    const regulationMinutes = parseInt(this.config.get('match.regulationMinutes'), 10);
    this.regulationSeconds = (Number.isFinite(regulationMinutes) && regulationMinutes > 0 ? regulationMinutes : 90) * 60;
    this.clockInterval = null;

    if (this.timerMode === 'countdown') {
      this.elapsedSeconds = this.regulationSeconds;
    }

    this._startClockTick();
  }

  _startClockTick() {
    this.clockInterval = setInterval(() => this._tick(), 1000);
  }

  _tick() {
    if (!this.clockRunning) return;

    if (this.inStoppage) {
      // ---- Additional time: main clock is frozen, the overlay keeps counting ----
      this.stoppageElapsedSeconds++;
      if (this.stoppageElapsedSeconds >= this.stoppageTimeMinutes * 60) {
        this.stoppageElapsedSeconds = this.stoppageTimeMinutes * 60;
        this.clockRunning = false;
        this.events.recordEvent('STOPPAGE_END', { allotted: `+${this.stoppageTimeMinutes}` });
        this.emit('clockChanged', this.getClockState());
        return;
      }
      this.emit('clockTick', this.getClockState());
      return;
    }

    if (this.timerMode === 'stopwatch') {
      this.elapsedSeconds++;
      if (this.elapsedSeconds >= this.regulationSeconds) {
        this.elapsedSeconds = this.regulationSeconds;
        this._reachRegulation();
        return;
      }
    } else {
      this.elapsedSeconds = Math.max(0, this.elapsedSeconds - 1);
      if (this.elapsedSeconds <= 0) {
        this._reachRegulation();
        return;
      }
    }
    this.emit('clockTick', this.getClockState());
  }

  _atRegulation() {
    return this.timerMode === 'stopwatch'
      ? this.elapsedSeconds >= this.regulationSeconds
      : this.elapsedSeconds <= 0;
  }

  // The set (regulation) time has been reached with nothing left on the main clock.
  _reachRegulation() {
    if (this.stoppageTimeMinutes > 0) {
      this._beginStoppage();
    } else {
      this.clockRunning = false;
      this.events.recordEvent('REGULATION_END', { time: this.getClockState().formatted });
      this.emit('clockChanged', this.getClockState());
    }
  }

  // Additional time begins: main display frozen at the set time, overlay counts +1:00 …
  _beginStoppage() {
    this.inStoppage = true;
    this.stoppageElapsedSeconds = 0;
    this.events.recordEvent('STOPPAGE_START', { allotted: `+${this.stoppageTimeMinutes}` });
    this.emit('clockChanged', this.getClockState());
  }

  // "+M:SS" overlay shown while counting additional time:
  // starts at +1:00, ticks through +1:59 → +2:00 … up to the allotted "+N:00".
  _formatStoppage() {
    const allotted = this.stoppageTimeMinutes;
    if (allotted <= 0) return '';
    if (this.stoppageElapsedSeconds >= allotted * 60) return `+${allotted}:00`;
    const minute = Math.floor(this.stoppageElapsedSeconds / 60) + 1;
    const secs = this.stoppageElapsedSeconds % 60;
    return `+${minute}:${String(secs).padStart(2, '0')}`;
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
      stoppageTime: this.stoppageTimeMinutes > 0 ? `+${this.stoppageTimeMinutes}` : '',
      mode: this.timerMode,
      regulationSeconds: this.regulationSeconds,
      inStoppage: this.inStoppage,
      stoppageMinutes: this.stoppageTimeMinutes,
      stoppageElapsedSeconds: this.stoppageElapsedSeconds,
      stoppageDisplay: this.inStoppage ? this._formatStoppage() : ''
    };
  }

  startClock() {
    if (!this.inStoppage && this._atRegulation()) {
      if (this.stoppageTimeMinutes > 0) {
        // Additional time was set at/after the set time → begin counting it now.
        this._beginStoppage();
      } else {
        // Set time reached with no additional time — nothing left to count.
        return this.getClockState();
      }
    }
    this.clockRunning = true;
    this.events.recordEvent('CLOCK_START', { time: this.getClockState().formatted });
    this.emit('clockChanged', this.getClockState());
    return this.getClockState();
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
    // Reset goes back to the START of the current mode: 00:00 (stopwatch) or the
    // full set time (countdown). Added time is always cleared with a reset.
    this.elapsedSeconds = this.timerMode === 'countdown' ? this.regulationSeconds : 0;
    this.inStoppage = false;
    this.stoppageElapsedSeconds = 0;
    this.events.recordEvent('CLOCK_RESET');
    this.emit('clockChanged', this.getClockState());
  }

  setClock({ seconds, period, stoppageMinutes, regulationMinutes } = {}) {
    if (regulationMinutes !== undefined) {
      const mins = parseInt(regulationMinutes, 10);
      if (Number.isFinite(mins) && mins > 0) {
        this.regulationSeconds = mins * 60;
        if (this.inStoppage) {
          this.elapsedSeconds = this.regulationSeconds; // main clock stays frozen at the set time
        } else if (this.elapsedSeconds > this.regulationSeconds) {
          this.elapsedSeconds = this.regulationSeconds;
        }
      }
    }
    if (seconds !== undefined) {
      const parsed = Math.max(0, parseInt(seconds, 10) || 0);
      this.elapsedSeconds = Math.min(parsed, this.regulationSeconds);
      if (this.inStoppage) {
        this.inStoppage = false;
        this.stoppageElapsedSeconds = 0;
      }
    }
    if (period !== undefined) this.period = period;
    if (stoppageMinutes !== undefined) {
      const mins = Math.max(0, parseInt(stoppageMinutes, 10) || 0);
      this.stoppageTimeMinutes = mins;
      if (this.inStoppage && mins === 0) {
        // Additional time cancelled mid-count → the overlay disappears and the clock stops.
        this.inStoppage = false;
        this.stoppageElapsedSeconds = 0;
        this.clockRunning = false;
      } else if (!this.inStoppage && mins > 0 && this._atRegulation()) {
        // Additional time set at/after the set time → the overlay appears and starts counting.
        this._beginStoppage();
        this.clockRunning = true;
      }
    }
    this.emit('clockChanged', this.getClockState());
    return this.getClockState();
  }

  setTimerMode(mode) {
    const nextMode = mode === 'countdown' ? 'countdown' : 'stopwatch';
    if (nextMode !== this.timerMode) {
      this.timerMode = nextMode;
      this.inStoppage = false;
      this.stoppageElapsedSeconds = 0;
      this.elapsedSeconds = nextMode === 'countdown' ? this.regulationSeconds : 0;
      this.config.set('match.timerMode', nextMode); // operator-initiated change → persisted
      this.events.recordEvent('TIMER_MODE_CHANGED', { mode: nextMode });
    }
    this.emit('clockChanged', this.getClockState());
    return this.getClockState();
  }

  setPeriod(period) {
    // Switching period ONLY changes the label — it never rewrites the clock.
    // The operator owns the time: start/pause/reset, or set it explicitly.
    this.period = period;
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
