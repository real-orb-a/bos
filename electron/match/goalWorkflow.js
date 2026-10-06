const EventEmitter = require('events');

/**
 * GoalWorkflowManager
 * -------------------
 * The automated goal sequence. BOS no longer plays replays itself — replay capture is
 * owned by the Source Record OBS plugin, and this workflow only TRIGGERS the save
 * hotkey (via ReplayEngine.captureReplay) when a goal is scored. Airing/playback is
 * a future phase (ReplayEngine.airReplay).
 *
 * Sequence:
 *   RECORD_EVENT → UPDATE_SCORE → GOAL_ANIMATION → CAPTURE_REPLAY
 *   → CELEBRATION → REPLAY → WAIT_FOR_GO_AHEAD → RETURN_TO_LIVE
 * Every phase can be disabled/reconfigured through goalWorkflow.* in config/bos.json.
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

      // 4. Capture Replay — trigger the Source Record "Save Replay Buffer" hotkey.
      //    BOS does NOT record, extract or play anything; Source Record owns the buffer.
      if (this.config.get('goalWorkflow.captureReplayOnGoal') && !this.isAborted) {
        this._updateStep('CAPTURE_REPLAY');
        const sourceId = this.config.get('goalWorkflow.replaySourceId') || undefined;
        const result = sourceId
          ? await this.replay.captureReplay({ sourceId })
          : await this.replay.captureAllReplays();
        if (result && result.ok) {
          this._updateStep('REPLAY_TRIGGERED');
          const savedSources = result.results ? result.results.length : 1;
          console.log(`[GoalWorkflow] Source Record replay save triggered for ${teamName} on ${savedSources} camera(s).`);
        } else {
          this._updateStep('REPLAY_FAILED');
          console.warn(`[GoalWorkflow] Source Record replay trigger failed: ${result && result.error}`);
        }
      }

      if (this.isAborted) return this._finishAborted();

      // 5. Celebration hold (config: celebrationDurationSeconds).
      const celebrationDuration = (this.config.get('goalWorkflow.celebrationDurationSeconds') || 3.0) * 1000;
      if (celebrationDuration > 0 && !this.isAborted) {
        this._updateStep('CELEBRATION');
        await this._delay(celebrationDuration);
      }

      if (this.isAborted) return this._finishAborted();

      // 6. Transition to the REPLAY scene under the custom graphical wipe.
      if (!this.isAborted) {
        this._updateStep('TRANSITION_TO_REPLAY');
        const team = isHome ? this.score.home : this.score.away;
        await this._transitionToScene('REPLAY', () => this.scenes.switchToReplay(), {
          color: team.color,
          color2: team.secondaryColor
        });
      }

      if (this.isAborted) return this._finishAborted();

      // 7. Keep REPLAY on air until the operator explicitly gives the go-ahead.
      this._updateStep('WAITING_FOR_GO_AHEAD');
      const goAhead = await this._waitForGoAhead();
      if (!goAhead || this.isAborted) return this._finishAborted();

      // 8. Return to Live under the same custom transition.
      this._updateStep('RETURN_TO_LIVE');
      const liveTransitionComplete = await this._transitionToScene(
        'LIVE',
        () => this.scenes.switchToLive()
      );
      if (!liveTransitionComplete && this.isAborted) return this._finishAborted();
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
    if (this.goAheadResolver) {
      const resume = this.goAheadResolver;
      this.goAheadResolver = null;
      resume(false);
    }
    console.warn('[GoalWorkflow] Aborting goal workflow sequence! Returning to LIVE.');
    this.emit('workflowAborted');

    await this.scenes.switchToLive();
    this.match.setTemporaryState('NONE');
    this.activeWorkflow = null;
    this.currentStep = null;
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

  continueToLive() {
    if (!this.activeWorkflow || this.currentStep !== 'WAITING_FOR_GO_AHEAD' || !this.goAheadResolver) {
      return false;
    }

    const resume = this.goAheadResolver;
    this.goAheadResolver = null;
    resume(true);
    return true;
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

  async _transitionToScene(title, switchScene, colors = {}) {
    if (this.isAborted) return false;

    const transitionId = `${this.activeWorkflow.id}_${title.toLowerCase()}_${Date.now()}`;
    const covered = this._waitForTransitionEvent('transitionCovered', transitionId, 500);
    const finished = this._waitForTransitionEvent('transitionFinished', transitionId, 1100);

    this.graphics.triggerTransition({
      id: transitionId,
      title,
      ...colors
    });

    await covered;
    if (this.isAborted) return false;

    const switched = await switchScene();
    if (!switched) {
      throw new Error(`Could not switch to the ${title} scene`);
    }

    if (this.isAborted) {
      await this.scenes.switchToLive();
      return false;
    }

    await finished;
    return !this.isAborted;
  }

  _waitForTransitionEvent(eventName, transitionId, timeoutMs) {
    return new Promise(resolve => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.graphics.removeListener(eventName, onTransitionEvent);
      };
      const onTransitionEvent = event => {
        if (!event || event.transitionId !== transitionId) return;
        cleanup();
        resolve(true);
      };
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      this.graphics.on(eventName, onTransitionEvent);
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