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
 *   RECORD_EVENT → UPDATE_SCORE → UPDATE_GRAPHIC → GOAL_ANIMATION
 *   → CAPTURE_REPLAY (Source Record trigger) → CELEBRATION → RETURN_TO_LIVE
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
  }

  async triggerGoal(teamKey, options = {}) {
    const isHome = teamKey.toLowerCase() === 'home' || teamKey.toUpperCase() === 'GARNET';
    const teamName = isHome ? this.score.home.name : this.score.away.name;

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
        player: options.player || ''
      });
      this._updateStep('RECORD_EVENT');

      // 2. Update Score (single clean 'flip' score graphic via the scoreChanged listener)
      this.graphics.queueScoreAnimation('flip');
      if (isHome) {
        this.score.addHome(1);
      } else {
        this.score.addAway(1);
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
        const result = await this.replay.captureReplay({ sourceId });
        if (result && result.ok) {
          this._updateStep('REPLAY_TRIGGERED');
          console.log(`[GoalWorkflow] Source Record replay save triggered for ${teamName} (${result.hotkeyName}).`);
        } else {
          this._updateStep('REPLAY_FAILED');
          console.warn(`[GoalWorkflow] Source Record replay trigger failed: ${result && result.error}`);
        }
      }

      if (this.isAborted) return this._finishAborted();

      // 5. Celebration (config: celebrationDurationSeconds)
      const celebrationDuration = (this.config.get('goalWorkflow.celebrationDurationSeconds') || 3.0) * 1000;
      if (celebrationDuration > 0 && !this.isAborted) {
        this._updateStep('CELEBRATION');
        await this._delay(celebrationDuration);
      }

      if (this.isAborted) return this._finishAborted();

      // 6. Return to Live
      this._updateStep('RETURN_TO_LIVE');
      await this.scenes.switchToLive();
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