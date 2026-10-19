const EventEmitter = require('events');

/**
 * GoalWorkflowManager runs the optional goal animation/replay-save sequence.
 * Replay stays opt-in; the operator can cancel at any point and return to LIVE.
 */
class GoalWorkflowManager extends EventEmitter {
  constructor(configManager, matchEngine, scoreManager, eventLogger, graphicsEngine, replayEngine, scenesController) {
    super();
    this.config = configManager;
    this.match = matchEngine;
    this.score = scoreManager;
    this.events = eventLogger;
    this.graphics = graphicsEngine;
    this.replay = replayEngine;
    this.scenes = scenesController;

    this.isAborted = false;
    this.currentStep = null;
    this.activeWorkflow = null;
    this.goAheadResolver = null;
    this.replayChoiceResolver = null;
  }

  async triggerGoal(teamKey, options = {}) {
    const isHome = teamKey.toLowerCase() === 'home' || teamKey.toUpperCase() === 'GARNET';
    const teamName = isHome ? this.score.home.name : this.score.away.name;
    const points = Math.max(1, parseInt(options.points, 10) || 1);

    const check = this.match.canStartSequence(`Goal: ${teamName}`, options.force);
    if (!check.allowed) {
      throw new Error(check.reason);
    }

    this.isAborted = false;
    this.activeWorkflow = {
      id: `gw_${Date.now()}`,
      team: teamName,
      isHome,
      startTime: Date.now()
    };

    console.log(`[GoalWorkflow] Starting Goal Sequence for ${teamName}...`);
    this.match.setTemporaryState('GOAL', `Goal: ${teamName}`);
    this.emit('workflowStarted', this.activeWorkflow);

    try {
      // 1. Record Goal Event & Timestamp
      const goalTimestamp = Date.now();
      const clockState = this.match.getClockState();
      this.events.recordEvent('GOAL', {
        team: teamName,
        isHome,
        matchClock: clockState.formatted,
        timestamp: goalTimestamp,
        player: options.player || '',
        points
      });
      this._updateStep('RECORD_EVENT');

      // 2. Update Score (single clean 'flip' score graphic via the scoreChanged listener)
      this.graphics.queueScoreAnimation('flip');
      if (isHome) {
        this.score.addHome(points);
      } else {
        this.score.addAway(points);
      }
      this._updateStep('UPDATE_SCORE');

      // 3. Goal Animation (config: showGoalAnimation / goalAnimationDuration)
      if (this.config.get('goalWorkflow.showGoalAnimation') && !this.isAborted) {
        this._updateStep('GOAL_ANIMATION');
        const animDuration = (this.config.get('goalWorkflow.goalAnimationDuration') || 3.0) * 1000;
        this.graphics.triggerGoalAnimation(teamName, {
          player: options.player,
          duration: animDuration / 1000
        });
        await this._delay(animDuration);
      }

      if (this.isAborted) return this._finishAborted();

      if (this.config.get('goalWorkflow.captureReplayOnGoal') && !this.isAborted) {
        this._updateStep('CAPTURE_REPLAY');
        const sourceId = this.config.get('goalWorkflow.replaySourceId') || undefined;
        const result = sourceId
          ? await this.replay.captureReplay({ sourceId })
          : await this.replay.captureAllReplays();
        if (!result || !result.ok) {
          this._updateStep('REPLAY_FAILED');
          console.warn(`[GoalWorkflow] Source Record replay trigger failed: ${result && result.error}`);
        } else {
          this._updateStep('REPLAY_CAPTURED');
        }
      }

      if (this.isAborted) return this._finishAborted();

      // Celebration hold (config: celebrationDurationSeconds).
      const configuredCelebrationDuration = Number(this.config.get('goalWorkflow.celebrationDurationSeconds'));
      const celebrationDuration = (Number.isFinite(configuredCelebrationDuration) && configuredCelebrationDuration >= 0
        ? configuredCelebrationDuration
        : 3.0) * 1000;
      if (celebrationDuration > 0 && !this.isAborted) {
        this._updateStep('CELEBRATION');
        await this._delay(celebrationDuration);
      }

      if (this.isAborted) return this._finishAborted();

      // Stay live unless the operator explicitly chooses to take replay on air.
      this._updateStep('WAITING_FOR_REPLAY_OPT_IN');
      const replayRequested = await this._waitForReplayChoice();
      if (!replayRequested || this.isAborted) return this._finishAborted();

      this._updateStep('SWITCHING_TO_REPLAY');
      const switched = await this.scenes.switchToReplay();
      if (!switched) {
        throw new Error('Could not switch OBS to the configured replay scene.');
      }
      if (this.isAborted) {
        await this.scenes.switchToLive();
        return this._finishAborted();
      }
      this._updateStep('REPLAY_ON_AIR');

      // Hold replay until the operator returns the program to LIVE.
      this._updateStep('WAITING_FOR_GO_AHEAD');
      const goAhead = await this._waitForGoAhead();
      if (!goAhead || this.isAborted) return this._finishAborted();

      this.match.setTemporaryState('NONE');

      this.activeWorkflow = null;
      this.currentStep = null;
      this.emit('workflowCompleted', { team: teamName });
      console.log(`[GoalWorkflow] Goal sequence for ${teamName} completed successfully.`);
      return true;

    } catch (err) {
      console.error('[GoalWorkflow] Error during goal sequence:', err);
      await this.abort();
      throw err;
    }
  }

  async abort() {
    this.isAborted = true;
    if (this.replayChoiceResolver) {
      const resume = this.replayChoiceResolver;
      this.replayChoiceResolver = null;
      resume(false);
    }
    if (this.goAheadResolver) {
      const resume = this.goAheadResolver;
      this.goAheadResolver = null;
      resume(false);
    }
    console.warn('[GoalWorkflow] Aborting goal workflow sequence! Returning to LIVE.');
    const switched = await this.scenes.switchToLive();
    this.match.setTemporaryState('NONE');
    this.activeWorkflow = null;
    this.currentStep = null;
    this.emit('workflowAborted');
    if (!switched) {
      throw new Error('Could not return OBS to the configured live scene while cancelling the sequence.');
    }
  }

  _finishAborted() {
    this.activeWorkflow = null;
    this.currentStep = null;
    return false;
  }

  _updateStep(step) {
    this.currentStep = step;
    this.emit('workflowStep', { step, workflow: this.activeWorkflow });
  }

  async continueToLive() {
    if (!this.activeWorkflow || this.currentStep !== 'WAITING_FOR_GO_AHEAD' || !this.goAheadResolver) {
      return false;
    }

    const resume = this.goAheadResolver;
    const switched = await this.scenes.switchToLive();
    if (!switched) {
      throw new Error('Could not switch OBS to the configured live scene.');
    }
    if (this.isAborted || this.goAheadResolver !== resume) return false;

    this.goAheadResolver = null;
    resume(true);
    return true;
  }

  goToReplay() {
    if (!this.activeWorkflow || this.currentStep !== 'WAITING_FOR_REPLAY_OPT_IN' || !this.replayChoiceResolver) {
      return false;
    }
    const resume = this.replayChoiceResolver;
    this.replayChoiceResolver = null;
    resume(true);
    return true;
  }

  _waitForReplayChoice() {
    return new Promise(resolve => {
      if (this.isAborted) {
        resolve(false);
        return;
      }
      this.replayChoiceResolver = resolve;
    });
  }

  _waitForGoAhead() {
    return new Promise(resolve => {
      if (this.isAborted) {
        resolve(false);
        return;
      }
      this.goAheadResolver = resolve;
    });
  }

  _delay(ms) {
    return new Promise(resolve => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (this.isAborted || Date.now() - start >= ms) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
  }

  getStatus() {
    return {
      isRunning: !!this.activeWorkflow,
      currentStep: this.currentStep,
      activeWorkflow: this.activeWorkflow
    };
  }
}

module.exports = GoalWorkflowManager;