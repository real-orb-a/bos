class ScenesController {
  constructor(obsClient, configManager) {
    this.obs = obsClient;
    this.config = configManager;
  }

  async getScenes() {
    try {
      const response = await this.obs.call('GetSceneList');
      return response.scenes.map(s => s.sceneName);
    } catch (err) {
      console.error('[ScenesController] getScenes failed:', err.message);
      return [];
    }
  }

  async getCurrentScene() {
    try {
      const response = await this.obs.call('GetCurrentProgramScene');
      return response.currentProgramSceneName;
    } catch (err) {
      console.error('[ScenesController] getCurrentScene failed:', err.message);
      return this.obs.currentScene;
    }
  }

  async switchScene(sceneName) {
    if (!sceneName) return;
    try {
      await this.obs.call('SetCurrentProgramScene', { sceneName });
      console.log(`[ScenesController] Switched to scene: ${sceneName}`);
      return true;
    } catch (err) {
      console.error(`[ScenesController] Failed to switch to scene ${sceneName}:`, err.message);
      return false;
    }
  }

  async switchToLive() {
    const liveScene = this.config.get('scenes.liveScene') || 'LIVE';
    return await this.switchScene(liveScene);
  }

  async switchToReplay() {
    const replayScene = this.config.get('scenes.replayScene') || 'REPLAY';
    return await this.switchScene(replayScene);
  }

  async switchToGraphics() {
    const graphicsScene = this.config.get('scenes.graphicsScene') || 'GRAPHICS';
    return await this.switchScene(graphicsScene);
  }
}

module.exports = ScenesController;
