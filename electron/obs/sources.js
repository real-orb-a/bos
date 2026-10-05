class SourcesController {
  constructor(obsClient, configManager) {
    this.obs = obsClient;
    this.config = configManager;
  }

  async setMediaSourceFile(inputName, filePath, loop = false) {
    const targetInput = inputName || this.config.get('scenes.replayMediaSource') || 'Replay Video';
    try {
      await this.obs.call('SetInputSettings', {
        inputName: targetInput,
        inputSettings: {
          local_file: filePath,
          looping: loop,
          restart_on_activate: true
        }
      });
      console.log(`[SourcesController] Set media source "${targetInput}" to: ${filePath}`);
      return true;
    } catch (err) {
      console.warn(`[SourcesController] setMediaSourceFile (${targetInput}) warning:`, err.message);
      return false;
    }
  }

  async playMedia(inputName) {
    const targetInput = inputName || this.config.get('scenes.replayMediaSource') || 'Replay Video';
    try {
      await this.obs.call('TriggerMediaInputAction', {
        inputName: targetInput,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
      });
      return true;
    } catch (err) {
      console.warn(`[SourcesController] playMedia (${targetInput}) warning:`, err.message);
      return false;
    }
  }

  async stopMedia(inputName) {
    const targetInput = inputName || this.config.get('scenes.replayMediaSource') || 'Replay Video';
    try {
      await this.obs.call('TriggerMediaInputAction', {
        inputName: targetInput,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
      });
      return true;
    } catch (err) {
      console.warn(`[SourcesController] stopMedia (${targetInput}) warning:`, err.message);
      return false;
    }
  }

  async refreshBrowserSource(inputName) {
    try {
      await this.obs.call('PressInputPropertiesButton', {
        inputName: inputName,
        propertyName: 'refreshnocache'
      });
      return true;
    } catch (err) {
      console.warn(`[SourcesController] refreshBrowserSource (${inputName}):`, err.message);
      return false;
    }
  }

  async setSourceVisible(sceneName, sceneItemId, enabled) {
    try {
      await this.obs.call('SetSceneItemEnabled', {
        sceneName: sceneName,
        sceneItemId: sceneItemId,
        sceneItemEnabled: enabled
      });
      return true;
    } catch (err) {
      console.warn(`[SourcesController] setSourceVisible error:`, err.message);
      return false;
    }
  }
}

module.exports = SourcesController;
