const EventEmitter = require('events');

/**
 * ReplayEngine (v2 — Source Record trigger service)
 * -------------------------------------------------
 * BOS no longer implements ANY replay capture/generation pipeline: no FFmpeg, no
 * rolling buffer, no clip extraction, no trimming, no media loading, no playback.
 *
 * Replay capture is owned entirely by the "Source Record" OBS plugin, which keeps
 * its own Replay Buffer running. BOS's only job here is to ask OBS to trigger
 * Source Record's "Save Replay Buffer" hotkey through the OBS WebSocket request
 * `TriggerHotkeyByName`.
 *
 *   BOS ──▶ OBS WebSocket TriggerHotkeyByName ──▶ Source Record filter ──▶ file
 *
 * `replay.hotkeyName` and `replay.contextName` are sent as separate fields in
 * `TriggerHotkeyByName`. Each capture source may override either value.
 *
 * BOS does not select saved files, load OBS media sources, or control playback.
 * Goal workflow can switch between the configured REPLAY and LIVE scenes, but the
 * OBS scene/plugin setup is responsible for presenting and playing the footage.
 */
class ReplayEngine extends EventEmitter {
  constructor(configManager, obsClient) {
    super();
    this.config = configManager;
    this.obs = obsClient;

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

  /**
   * Operation B — Air Replay (FUTURE).
   * Selecting the saved file, loading the OBS replay media source, switching to
   * the REPLAY scene, playing, and returning to LIVE. Deliberately NOT
   * implemented in this phase — kept as the extension point for the airing system.
   */
  async airReplay(/* clip */) {
    return {
      ok: false,
      state: this.state,
      message: 'Replay airing is not implemented in this phase.'
    };
  }

  getStatus() {
    return {
      enabled: this.enabled,
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