class TransitionsController {
  constructor(obsClient, configManager) {
    this.obs = obsClient;
    this.config = configManager;
  }

  async getTransitions() {
    try {
      const response = await this.obs.call('GetSceneTransitionList');
      return response.transitions.map(t => t.transitionName);
    } catch (err) {
      console.warn('[TransitionsController] getTransitions error:', err.message);
      return ['Cut', 'Fade', 'Swipe', 'Slide'];
    }
  }

  async getCurrentTransition() {
    try {
      const response = await this.obs.call('GetCurrentSceneTransition');
      return {
        name: response.transitionName,
        duration: response.transitionDuration
      };
    } catch (err) {
      return {
        name: this.config.get('transitions.defaultTransition') || 'Fade',
        duration: this.config.get('transitions.durationMs') || 300
      };
    }
  }

  async setTransition(transitionName) {
    try {
      await this.obs.call('SetCurrentSceneTransition', { transitionName });
      this.config.set('transitions.defaultTransition', transitionName);
      return true;
    } catch (err) {
      console.warn(`[TransitionsController] setTransition (${transitionName}) error:`, err.message);
      return false;
    }
  }

  async setDuration(durationMs) {
    try {
      await this.obs.call('SetCurrentSceneTransitionDuration', {
        transitionDuration: parseInt(durationMs, 10)
      });
      this.config.set('transitions.durationMs', parseInt(durationMs, 10));
      return true;
    } catch (err) {
      console.warn(`[TransitionsController] setDuration error:`, err.message);
      return false;
    }
  }
}

module.exports = TransitionsController;
