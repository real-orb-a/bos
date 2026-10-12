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
    //   timerMode 'none' disables the clock for untimed matches.
    //   Once the set time is reached, if additional (stoppage) time has been set the
    //   main clock FREEZES at the set time and a 00:00 overlay below it counts the
    //   added time until the allotted stoppage is used up, then the clock stops.
    this.clockRunning = false;
    this.elapsedSeconds = 0;
    this.period = this.config.get('match.periodLabel') || '1st Half';
    this.stoppageTimeMinutes = 0;    // allotted additional time in minutes (N)
    this.stoppageElapsedSeconds = 0; // additional time consumed so far (seconds)
    this.inStoppage = false;
    this.awaitingStoppageApproval = false;
    this.additionalTimeMode = this.config.get('match.additionalTimeMode') === 'approval' ? 'approval' : 'automatic';
    const configuredTimerMode = this.config.get('match.timerMode');
    this.timerMode = ['countdown', 'none'].includes(configuredTimerMode) ? configuredTimerMode : 'stopwatch';
    const regulationMinutes = parseInt(this.config.get('match.regulationMinutes'), 10);
    this.regulationSeconds = (Number.isFinite(regulationMinutes) && regulationMinutes > 0 ? regulationMinutes : 90) * 60;
    const configuredStartSeconds = parseInt(this.config.get('match.startSeconds'), 10);
    this.hasConfiguredStartSeconds = Number.isFinite(configuredStartSeconds) && configuredStartSeconds >= 0;
    this.startSeconds = Number.isFinite(configuredStartSeconds) && configuredStartSeconds >= 0
      ? Math.min(configuredStartSeconds, this.regulationSeconds)
      : (this.timerMode === 'countdown' ? this.regulationSeconds : 0);
    this.clockInterval = null;

    this.elapsedSeconds = this.startSeconds;
    const configuredBestOfSets = parseInt(this.config.get('match.bestOfSets'), 10);
    this.bestOfSets = Number.isFinite(configuredBestOfSets) ? Math.min(9, Math.max(1, configuredBestOfSets)) : 3;
    const configuredCompletedSets = this.config.get('match.completedSets');
    this.completedSets = Array.isArray(configuredCompletedSets) ? configuredCompletedSets : [];
    const homeSetsWon = this.config.get('match.homeSetsWon');
    const awaySetsWon = this.config.get('match.awaySetsWon');
    this.homeSetsWon = Number.isInteger(homeSetsWon)
      ? Math.max(0, homeSetsWon)
      : this.completedSets.filter(set => set.winner === 'home').length;
    this.awaySetsWon = Number.isInteger(awaySetsWon)
      ? Math.max(0, awaySetsWon)
      : this.completedSets.filter(set => set.winner === 'away').length;

    this._startClockTick();
  }

  _startClockTick() {
    this.clockInterval = setInterval(() => this._tick(), 1000);
  }

  _tick() {
    if (!this.clockRunning || this.timerMode === 'none') return;

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
      if (this.additionalTimeMode === 'approval') {
        this._awaitStoppageApproval();
      } else {
        this._beginStoppage();
      }
    } else {
      this.clockRunning = false;
      this.events.recordEvent('REGULATION_END', { time: this.getClockState().formatted });
      this.emit('clockChanged', this.getClockState());
    }
  }

  // Additional time begins: main display frozen at the set time, overlay counts from 00:00.
  _beginStoppage() {
    this.awaitingStoppageApproval = false;
    this.inStoppage = true;
    this.stoppageElapsedSeconds = 0;
    this.events.recordEvent('STOPPAGE_START', { allotted: `+${this.stoppageTimeMinutes}` });
    this.emit('clockChanged', this.getClockState());
  }

  _awaitStoppageApproval() {
    if (this.awaitingStoppageApproval) return;
    this.clockRunning = false;
    this.awaitingStoppageApproval = true;
    this.events.recordEvent('STOPPAGE_AWAITING_APPROVAL', {
      allotted: `+${this.stoppageTimeMinutes}`
    });
    this.emit('clockChanged', this.getClockState());
  }

  // Elapsed additional time shown below the frozen regulation clock (00:00 → N:00).
  _formatStoppage() {
    const minute = Math.floor(this.stoppageElapsedSeconds / 60);
    const secs = this.stoppageElapsedSeconds % 60;
    return `${String(minute).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  getClockState() {
    const mins = Math.floor(this.elapsedSeconds / 60);
    const secs = this.elapsedSeconds % 60;
    const formatted = this.timerMode === 'none'
      ? 'NO TIME'
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return {
      running: this.clockRunning,
      elapsedSeconds: this.elapsedSeconds,
      formatted,
      period: this.period,
      stoppageTime: this.stoppageTimeMinutes > 0 ? `+${this.stoppageTimeMinutes}` : '',
      mode: this.timerMode,
      regulationSeconds: this.regulationSeconds,
      additionalTimeMode: this.additionalTimeMode,
      inStoppage: this.inStoppage,
      awaitingStoppageApproval: this.awaitingStoppageApproval,
      stoppageMinutes: this.stoppageTimeMinutes,
      stoppageElapsedSeconds: this.stoppageElapsedSeconds,
      stoppageDisplay: this.inStoppage ? this._formatStoppage() : ''
    };
  }

  startClock() {
    if (this.timerMode === 'none') return this.getClockState();
    if (this.awaitingStoppageApproval) return this.getClockState();

    if (!this.inStoppage && this._atRegulation()) {
      if (this.stoppageTimeMinutes > 0) {
        if (this.additionalTimeMode === 'approval') {
          this._awaitStoppageApproval();
          return this.getClockState();
        }
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
      this.awaitingStoppageApproval = false;
    // Reset goes back to the START of the current mode: 00:00 (stopwatch) or the
    // full set time (countdown). Added time is always cleared with a reset.
    this.elapsedSeconds = this.hasConfiguredStartSeconds
      ? this.startSeconds
      : (this.timerMode === 'countdown' ? this.regulationSeconds : 0);
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
        if (this.hasConfiguredStartSeconds && this.startSeconds > this.regulationSeconds) {
          this.startSeconds = this.regulationSeconds;
          this.config.set('match.startSeconds', this.startSeconds);
        }
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
        this.awaitingStoppageApproval = false;
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
        this.awaitingStoppageApproval = false;
        this.stoppageElapsedSeconds = 0;
        this.clockRunning = false;
      } else if (this.awaitingStoppageApproval && mins === 0) {
        this.awaitingStoppageApproval = false;
      } else if (!this.inStoppage && mins > 0 && this._atRegulation()) {
        if (this.additionalTimeMode === 'approval') {
          this._awaitStoppageApproval();
        } else {
          this._beginStoppage();
          this.clockRunning = true;
        }
      }
    }
    this.emit('clockChanged', this.getClockState());
    return this.getClockState();
  }

  setStartTime(seconds) {
    const parsed = Math.max(0, parseInt(seconds, 10) || 0);
    this.startSeconds = Math.min(parsed, this.regulationSeconds);
    this.hasConfiguredStartSeconds = true;
    this.elapsedSeconds = this.startSeconds;
    if (this.inStoppage) {
      this.inStoppage = false;
      this.awaitingStoppageApproval = false;
      this.stoppageElapsedSeconds = 0;
    }
    this.config.set('match.startSeconds', this.startSeconds);
    this.emit('clockChanged', this.getClockState());
    return this.getClockState();
  }

  setTimerMode(mode) {
      this.awaitingStoppageApproval = false;
    const nextMode = ['countdown', 'none'].includes(mode) ? mode : 'stopwatch';
    if (nextMode !== this.timerMode) {
      const previousMode = this.timerMode;
      this.timerMode = nextMode;
      this.clockRunning = false;
      this.inStoppage = false;
      this.stoppageTimeMinutes = 0;
      this.stoppageElapsedSeconds = 0;
      if (nextMode !== 'none') {
        this.elapsedSeconds = previousMode === 'none'
          ? (this.hasConfiguredStartSeconds ? this.startSeconds : (nextMode === 'countdown' ? this.regulationSeconds : 0))
          : this.elapsedSeconds;
      }
      this.config.set('match.timerMode', nextMode); // operator-initiated change → persisted
      this.events.recordEvent('TIMER_MODE_CHANGED', { mode: nextMode });
    }
    this.emit('clockChanged', this.getClockState());
    return this.getClockState();
  }

  setAdditionalTimeMode(mode) {
    const nextMode = mode === 'approval' ? 'approval' : 'automatic';
    if (nextMode !== this.additionalTimeMode) {
      this.additionalTimeMode = nextMode;
      this.config.set('match.additionalTimeMode', nextMode);
      this.events.recordEvent('ADDITIONAL_TIME_MODE_CHANGED', { mode: nextMode });
      if (nextMode === 'automatic' && this.awaitingStoppageApproval) {
        this._beginStoppage();
        this.clockRunning = true;
      }
    }
    this.emit('clockChanged', this.getClockState());
    return this.getClockState();
  }

  approveAdditionalTime() {
    if (!this.awaitingStoppageApproval || this.stoppageTimeMinutes <= 0) return false;
    this._beginStoppage();
    this.clockRunning = true;
    this.events.recordEvent('STOPPAGE_APPROVED', { allotted: `+${this.stoppageTimeMinutes}` });
    this.emit('clockChanged', this.getClockState());
    return this.getClockState();
  }

  setPeriod(period) {
    // Switching period ONLY changes the label — it never rewrites the clock.
    // The operator owns the time: start/pause/reset, or set it explicitly.
    this.period = period;
    this.config.set('match.periodLabel', period);
    this.events.recordEvent('PERIOD_CHANGED', { period });
    this.emit('clockChanged', this.getClockState());
  }

  getSetState() {
    return {
      bestOfSets: this.bestOfSets,
      completedSets: this.completedSets.map(set => ({ ...set })),
      homeSets: this.homeSetsWon,
      awaySets: this.awaySetsWon
    };
  }

  setBestOfSets(count) {
    const parsed = Number(count);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9) {
      throw new Error('Best-of sets must be a whole number from 1 to 9.');
    }
    this.bestOfSets = parsed;
    this.config.set('match.bestOfSets', parsed);
    this.emit('setsChanged', this.getSetState());
    return this.getSetState();
  }

  completeSet(winner) {
    if (winner !== 'home' && winner !== 'away') {
      throw new Error('Set winner must be home or away.');
    }
    if (this.completedSets.length >= this.bestOfSets) {
      throw new Error('All configured sets have already been completed.');
    }
    const team = this.score[winner];
    const completed = {
      number: this.completedSets.length + 1,
      winner,
      team: team.name,
      points: { home: this.score.home.score, away: this.score.away.score },
      timestamp: Date.now()
    };
    this.completedSets.push(completed);
    this._adjustSetTally(winner, 1);
    this.config.set('match.completedSets', this.completedSets);
    this.events.recordEvent('SET_COMPLETED', {
      set: completed.number,
      winner,
      team: team.name,
      points: completed.points
    });
    this.score.resetScore();
    this.emit('setsChanged', this.getSetState());
    return this.getSetState();
  }

  removeCompletedSet(setNumber) {
    const parsed = Number(setNumber);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > this.completedSets.length) {
      throw new Error('Set number must match a completed set.');
    }
    const [removed] = this.completedSets.splice(parsed - 1, 1);
    this._adjustSetTally(removed.winner, -1);
    this.completedSets.forEach((set, index) => {
      set.number = index + 1;
    });
    this.config.set('match.completedSets', this.completedSets);
    this.events.recordEvent('SET_REMOVED', {
      set: removed.number,
      winner: removed.winner,
      team: removed.team,
      points: removed.points
    });
    this.emit('setsChanged', this.getSetState());
    return this.getSetState();
  }

  resetSets() {
    this.completedSets = [];
    this.homeSetsWon = 0;
    this.awaySetsWon = 0;
    this.config.set('match.completedSets', this.completedSets);
    this.config.set('match.homeSetsWon', this.homeSetsWon);
    this.config.set('match.awaySetsWon', this.awaySetsWon);
    this.events.recordEvent('SETS_RESET');
    this.emit('setsChanged', this.getSetState());
    return this.getSetState();
  }

  adjustSetTally(team, amount) {
    if (!['home', 'away'].includes(team) || ![-1, 1].includes(Number(amount))) {
      throw new Error('Set tally adjustment must be +1 or -1 for home or away.');
    }
    this._adjustSetTally(team, Number(amount));
    this.events.recordEvent('SET_TALLY_ADJUSTED', {
      team,
      amount: Number(amount),
      total: team === 'home' ? this.homeSetsWon : this.awaySetsWon
    });
    this.emit('setsChanged', this.getSetState());
    return this.getSetState();
  }

  _adjustSetTally(team, amount) {
    const property = team === 'home' ? 'homeSetsWon' : 'awaySetsWon';
    this[property] = Math.max(0, this[property] + amount);
    this.config.set(`match.${property}`, this[property]);
  }

  resetScoreAndSets() {
    const score = this.score.resetScore();
    this.resetSets();
    this.events.recordEvent('MATCH_SCORE_AND_SETS_RESET');
    return { score, sets: this.getSetState() };
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
      score: this.score.getScore(),
      sets: this.getSetState()
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
