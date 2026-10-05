const { OBSWebSocket } = require('obs-websocket-js');
const EventEmitter = require('events');

class OBSClient extends EventEmitter {
  constructor(configManager) {
    super();
    this.configManager = configManager;
    this.obs = new OBSWebSocket();
    this.isConnected = false;
    this.isConnecting = false;
    this.isMockMode = false;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.latencyMs = 0;
    this.currentScene = 'LIVE';
    this.availableScenes = ['LIVE', 'REPLAY', 'GRAPHICS'];
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
      this.isMockMode = false;
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
      this.emit('connected', { isMock: false, currentScene: this.currentScene, availableScenes: this.availableScenes });
      console.log('[OBSClient] Connected to OBS Studio.');
    } catch (err) {
      this.isConnecting = false;
      this._setDisconnected();
      console.warn(`[OBSClient] Failed to connect to OBS (${err.message}). Entering Mock/Simulation mode for seamless operation.`);
      
      // Auto-fallback to simulator mode so operator can still test, practice and run cues
      this.enableMockMode();

      if (this.configManager.get('obs.autoReconnect')) {
        this.scheduleReconnect();
      }
    }
  }

  enableMockMode() {
    this.isMockMode = true;
    this.isConnected = true;
    this.currentScene = this.configManager.get('scenes.liveScene') || 'LIVE';
    this.availableScenes = [
      this.configManager.get('scenes.liveScene') || 'LIVE',
      this.configManager.get('scenes.replayScene') || 'REPLAY',
      this.configManager.get('scenes.graphicsScene') || 'GRAPHICS'
    ];
    this.latencyMs = 1;
    this.emit('connected', { isMock: true, currentScene: this.currentScene, availableScenes: this.availableScenes });
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopPing();

    if (this.isConnected && !this.isMockMode) {
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
    this.isMockMode = false;
    this.isConnecting = false;
    this._stopPing();
    this.emit('disconnected');
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const interval = this.configManager.get('obs.reconnectIntervalMs') || 3000;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.isConnected || this.isMockMode) {
        await this.connect();
      }
    }, interval);
  }

  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(async () => {
      if (this.isConnected && !this.isMockMode) {
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
    if (this.isMockMode) {
      return this._mockCall(requestType, requestData);
    }
    if (!this.isConnected) {
      throw new Error('OBS is not connected.');
    }
    return await this.obs.call(requestType, requestData);
  }

  _mockCall(requestType, requestData) {
    console.log(`[OBS-MOCK] call ${requestType}:`, requestData);
    if (requestType === 'GetCurrentProgramScene') {
      return { currentProgramSceneName: this.currentScene };
    }
    if (requestType === 'SetCurrentProgramScene') {
      this.currentScene = requestData.sceneName;
      this.emit('sceneChanged', this.currentScene);
      return {};
    }
    if (requestType === 'GetSceneList') {
      return { currentProgramSceneName: this.currentScene, scenes: this.availableScenes.map(s => ({ sceneName: s })) };
    }
    if (requestType === 'GetRecordStatus') {
      return { outputActive: this.recordStatus.active, outputTimecode: this.recordStatus.timecode };
    }
    if (requestType === 'GetStreamStatus') {
      return { outputActive: this.streamStatus.active, outputTimecode: this.streamStatus.timecode };
    }
    return {};
  }

  getStatus() {
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      isMock: this.isMockMode,
      currentScene: this.currentScene,
      availableScenes: this.availableScenes,
      latencyMs: this.latencyMs,
      stream: this.streamStatus,
      record: this.recordStatus
    };
  }
}

module.exports = OBSClient;
