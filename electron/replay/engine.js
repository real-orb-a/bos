const EventEmitter = require('events');
const path = require('path');

/**
 * ReplayEngine delegates capture to OBS Source Record and controls playback
 * through an OBS Media Source. OBS remains responsible for writing replay files.
 */
class ReplayEngine extends EventEmitter {
  constructor(configManager, obsClient, sourcesController, scenesController) {
    super();
    this.config = configManager;
    this.obs = obsClient;
    this.sources = sourcesController;
    this.scenes = scenesController;
    this.airing = false;

    // The state represents the REQUEST, not any footage contents:
    //   IDLE → TRIGGERING → TRIGGERED | ERROR
    this.state = 'IDLE';
    this.lastResult = null;
    this.lastError = null;
    this.lastTriggeredAt = null;
  }

  get enabled() {
    return this.config.get('replay.enabled') !== false;
  }

  get defaultHotkey() {
    return {
      hotkeyName: this.config.get('replay.hotkeyName') || 'ReplayBuffer.Save',
      contextName: this.config.get('replay.contextName') || 'test1 - Source Record'
    };
  }

  get captureSources() {
    const list = this.config.get('replay.captureSources');
    return Array.isArray(list) ? list.filter(s => s && s.enabled) : [];
  }

  /** Resolve the hotkey/context pair, preferring a per-source override. */
  resolveHotkey(sourceId = null) {
    const src = sourceId ? this.captureSources.find(s => s.id === sourceId) : null;
    const fallback = this.defaultHotkey;
    const hotkeyName = (src && src.hotkeyName) || fallback.hotkeyName;
    const contextName = src && src.contextName ? src.contextName : fallback.contextName;
    return {
      sourceId: src ? src.id : null,
      hotkeyName,
      contextName
    };
  }

  /**
   * Operation A — Capture Replay.
   * Ask OBS to trigger Source Record's "Save Replay Buffer" hotkey.
   * A success here only means OBS accepted the hotkey trigger — it does NOT prove
   * that Source Record wrote a file (that happens asynchronously in OBS).
   *
   * @param {object} options { sourceId? } — an entry from replay.captureSources.
   * @returns {Promise<{ok, state, hotkeyName, contextName, sourceId?, error?}>}
   */
  async captureReplay(options = {}) {
    if (this.state === 'TRIGGERING') {
      return { ok: false, state: this.state, error: 'A replay save is already being triggered.' };
    }
    if (!this.enabled) {
      this.state = 'ERROR';
      this.lastError = 'Replay capture is disabled in configuration (replay.enabled = false).';
      this.emit('replayStateChanged', this.getStatus());
      return { ok: false, state: this.state, error: this.lastError };
    }
    if (!this.obs.isConnected) {
      this.state = 'ERROR';
      this.lastError = 'OBS is not connected — cannot trigger the Source Record hotkey.';
      this.emit('replayStateChanged', this.getStatus());
      return { ok: false, state: this.state, error: this.lastError };
    }

    const cfg = this.resolveHotkey(options.sourceId);
    this.state = 'TRIGGERING';
    this.lastError = null;
    this.lastResult = null;
    this.emit('replayStateChanged', this.getStatus());

    // Log everything needed to diagnose the WebSocket request.
    console.log('[Replay] Triggering Source Record replay save');
    console.log(`[Replay] hotkeyName=${cfg.hotkeyName}`);
    console.log(`[Replay] contextName=${cfg.contextName}`);

    const request = {
      hotkeyName: cfg.hotkeyName,
      contextName: cfg.contextName
    };

    try {
      await this.obs.call('TriggerHotkeyByName', request);
      this.state = 'TRIGGERED';
      this.lastResult = {
        hotkeyName: cfg.hotkeyName,
        contextName: cfg.contextName,
        sourceId: cfg.sourceId,
        timestamp: Date.now()
      };
      this.lastTriggeredAt = this.lastResult.timestamp;
      console.log('[Replay] TriggerHotkeyByName succeeded');
      this.emit('replayStateChanged', this.getStatus());
      return { ok: true, state: this.state, ...this.lastResult };
    } catch (err) {
      this.state = 'ERROR';
      this.lastError = err.message || String(err);
      console.log('[Replay] Failed to trigger Source Record replay');
      console.log(`[Replay] ${this.lastError}`);
      this.emit('replayStateChanged', this.getStatus());
      return { ok: false, state: this.state, error: this.lastError };
    }
  }

  async captureAllReplays() {
    if (this.state === 'TRIGGERING') {
      return { ok: false, state: this.state, error: 'A replay save is already being triggered.' };
    }

    const sources = this.captureSources;
    if (!sources.length) return this.captureReplay();

    const results = [];
    for (const source of sources) {
      results.push(await this.captureReplay({ sourceId: source.id }));
    }

    const failed = results.find(result => !result.ok);
    return {
      ok: !failed,
      state: this.state,
      results,
      ...(failed ? { error: failed.error } : {})
    };
  }

  /** Load a selected file into OBS, air it, then return to LIVE when stopped/ended. */
  async airReplay(filePath) {
    if (typeof filePath !== 'string' || !filePath || !this.sources || !this.scenes) {
      throw new Error('Choose a replay video before airing it.');
    }
    if (!this.obs.isConnected) throw new Error('OBS is not connected — cannot air a replay.');

    const mediaSource = this.config.get('scenes.replayMediaSource') || 'Replay Video';
    const configured = await this.sources.setMediaSourceFile(mediaSource, filePath, false);
    if (!configured) throw new Error(`OBS media source "${mediaSource}" could not load the selected replay.`);

    const switched = await this.scenes.switchToReplay();
    if (!switched) throw new Error('OBS could not switch to the configured replay scene.');
    const started = await this.sources.playMedia(mediaSource);
    if (!started) {
      await this.scenes.switchToLive();
      throw new Error(`OBS could not start replay media source "${mediaSource}".`);
    }

    this.airing = true;
    this.lastResult = { fileName: path.basename(filePath), timestamp: Date.now() };
    this.emit('replayStateChanged', this.getStatus());
    return { ok: true, state: 'AIRING', ...this.lastResult };
  }

  async stopReplay() {
    if (!this.airing) return { ok: true, state: 'IDLE' };
    const mediaSource = this.config.get('scenes.replayMediaSource') || 'Replay Video';
    const stopped = await this.sources.stopMedia(mediaSource);
    if (!stopped) throw new Error(`OBS could not stop replay media source "${mediaSource}".`);
    const live = await this.scenes.switchToLive();
    if (!live) throw new Error('OBS could not return to the configured LIVE scene.');
    this.airing = false;
    this.emit('replayStateChanged', this.getStatus());
    return { ok: true, state: 'IDLE' };
  }

  async handlePlaybackEnded(inputName) {
    const replaySource = this.config.get('scenes.replayMediaSource') || 'Replay Video';
    if (!this.airing || inputName !== replaySource) return false;
    await this.stopReplay();
    return true;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      airing: this.airing,
      state: this.state,
      lastResult: this.lastResult,
      lastError: this.lastError,
      lastTriggeredAt: this.lastTriggeredAt,
      defaultHotkey: this.defaultHotkey,
      sources: this.captureSources.map(source => ({
        id: source.id,
        name: source.name,
        ...this.resolveHotkey(source.id)
      }))
    };
  }

  destroy() {}
}

module.exports = ReplayEngine;