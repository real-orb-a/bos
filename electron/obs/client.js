const { OBSWebSocket } = require('obs-websocket-js');
const EventEmitter = require('events');

/**
 * OBSClient
 * ---------
 * OBS WebSocket v5 gateway. BOS always talks to the REAL OBS Studio — there is no
 * simulator/mock fallback. If OBS is unreachable the client reports DISCONNECTED and
 * keeps retrying; any privileged call simply fails until the connection is restored.
 */
class OBSClient extends EventEmitter {
  constructor(configManager) {
    super();
    this.configManager = configManager;
    this.obs = new OBSWebSocket();
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.latencyMs = 0;
    this.currentScene = null;
    this.availableScenes = [];
    this.streamStatus = { active: false, timecode: '00:00:00' };
    this.recordStatus = { active: false, timecode: '00:00:00' };

    this._bindEvents();
  }

  _bindEvents() {
    this.obs.on('ConnectionClosed', (data) => {
      console.log('[OBSClient] Connection closed:', data);
      this._setDisconnected();
      if (this.configManager.get('obs.autoReconnect')) {
        this.scheduleReconnect();
      }
    });

    this.obs.on('CurrentProgramSceneChanged', (data) => {
      this.currentScene = data.sceneName;
      this.emit('sceneChanged', data.sceneName);
    });

    this.obs.on('StreamStateChanged', (data) => {
      this.streamStatus.active = data.outputActive;
      this.emit('streamStatusChanged', this.streamStatus);
    });

    this.obs.on('RecordStateChanged', (data) => {
      this.recordStatus.active = data.outputActive;
      this.emit('recordStatusChanged', this.recordStatus);
    });

    this.obs.on('MediaInputPlaybackEnded', (data) => {
      this.emit('mediaPlaybackEnded', data.inputName);
    });
  }

  async connect() {
    if (this.isConnected || this.isConnecting) return;
    this.isConnecting = true;
    this.emit('connecting');

    const host = this.configManager.get('obs.host') || 'localhost';
    const port = this.configManager.get('obs.port') || 4455;
    const password = this.configManager.get('obs.password') || undefined;
    const url = `ws://${host}:${port}`;

    try {
      console.log(`[OBSClient] Connecting to ${url}...`);
      await this.obs.connect(url, password);
      this.isConnected = true;
      this.isConnecting = false;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Fetch initial state
      try {
        const { currentProgramSceneName } = await this.obs.call('GetCurrentProgramScene');
        this.currentScene = currentProgramSceneName;
        const { scenes } = await this.obs.call('GetSceneList');
        this.availableScenes = scenes.map(s => s.sceneName);
      } catch (e) {
        console.warn('[OBSClient] Could not fetch initial scenes:', e.message);
      }

      this._startPing();
      this.emit('connected', { currentScene: this.currentScene, availableScenes: this.availableScenes });
      console.log('[OBSClient] Connected to OBS Studio.');
    } catch (err) {
      this.isConnecting = false;
      this._setDisconnected();
      console.warn(`[OBSClient] Failed to connect to OBS (${err.message}). Will keep retrying.`);

      if (this.configManager.get('obs.autoReconnect')) {
        this.scheduleReconnect();
      }
    }
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopPing();

    if (this.isConnected) {
      try {
        await this.obs.disconnect();
      } catch (err) {
        console.error('[OBSClient] Error disconnecting:', err);
      }
    }
    this._setDisconnected();
  }

  _setDisconnected() {
    this.isConnected = false;
    this.isConnecting = false;
    this._stopPing();
    this.emit('disconnected');
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const interval = this.configManager.get('obs.reconnectIntervalMs') || 3000;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.isConnected) {
        await this.connect();
      }
    }, interval);
  }

  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(async () => {
      if (this.isConnected) {
        const start = Date.now();
        try {
          await this.obs.call('GetVersion');
          this.latencyMs = Date.now() - start;
          this.emit('ping', this.latencyMs);
        } catch {
          this.latencyMs = 0;
        }
      }
    }, 5000);
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  async call(requestType, requestData) {
    if (!this.isConnected) {
      throw new Error('OBS is not connected.');
    }
    return await this.obs.call(requestType, requestData);
  }

  getStatus() {
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      currentScene: this.currentScene,
      availableScenes: this.availableScenes,
      latencyMs: this.latencyMs,
      stream: this.streamStatus,
      record: this.recordStatus
    };
  }
}

module.exports = OBSClient;