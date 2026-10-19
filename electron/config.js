const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ConfigManager extends EventEmitter {
  constructor(configPath) {
    super();
    this.loadError = null;
    this.lastSaveError = null;
    this._sessionBackupDone = false;
    this._writeBlocked = false;
    this.configPath = configPath || path.join(__dirname, '..', 'config', 'bos.json');
    this.config = this.load();
  }

  load() {
    this.loadError = null;
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Configuration root must be a JSON object.');
        }
        this.config = parsed;
        return this.config;
      }
    } catch (err) {
      // Never silently replace a damaged file with defaults: keep a copy of the
      // damaged file first, then remember the problem so the UI can report it.
      this.loadError = this._preserveCorruptFile(err);
      // Only overwrite the file later if the damaged original was safely copied
      // aside. A read failure that is not a parse problem (locked file, permissions)
      // must never lead to the existing file being replaced by defaults.
      const isParseProblem = err instanceof SyntaxError || /root must be/.test(err.message || '');
      this._writeBlocked = !(isParseProblem && this.loadError.backupPath);
      console.error('[ConfigManager] Failed to read config:', this.loadError.message,
        this.loadError.backupPath ? `(damaged file preserved at ${this.loadError.backupPath})` : '');
    }
    // Fallback defaults
    this.config = {
      obs: { host: 'localhost', port: 4455, password: '', autoReconnect: true, reconnectIntervalMs: 3000 },
      teams: {
        home: { name: 'GARNET', short: 'GAR', color: '#e11d48', secondaryColor: '#7f1d1d', hotkey: 'KeyG', score: 0 },
        away: { name: 'TOPAZ', short: 'TOP', color: '#eab308', secondaryColor: '#713f12', hotkey: 'KeyT', score: 0 },
        // The three houses: Garnet (red), Emerald (green), Topaz (yellow).
        // Teams pick their palette from here; colours drive every broadcast graphic.
        houses: {
          garnet: { name: 'GARNET', short: 'GAR', color: '#e11d48', secondaryColor: '#7f1d1d' },
          emerald: { name: 'EMERALD', short: 'EME', color: '#10b981', secondaryColor: '#064e3b' },
          topaz: { name: 'TOPAZ', short: 'TOP', color: '#eab308', secondaryColor: '#713f12' }
        }
      },
      scenes: { liveScene: 'LIVE', replayScene: 'REPLAY', graphicsScene: 'GRAPHICS', replayMediaSource: 'Replay Video' },
      replay: {
        enabled: true,
        hotkeyName: 'ReplayBuffer.Save',
        contextName: 'test1 - Source Record',
        captureSources: [
          { id: 'main', name: 'Main Program', enabled: true, hotkeyName: '', contextName: '' },
          { id: 'cam1', name: 'Camera 1', enabled: false, hotkeyName: '', contextName: '' },
          { id: 'cam2', name: 'Camera 2', enabled: false, hotkeyName: '', contextName: '' }
        ]
      },
      graphics: { host: '127.0.0.1', allowedClients: [], httpPort: 8088, wsPort: 8088, defaultLowerThirdDuration: 5, animationStyle: 'slide-in', lowerThirdColor: '#eab308' },
      transitions: { defaultTransition: 'Fade', durationMs: 300 },
      match: {
        // 'stopwatch' counts up to the set time (football), 'countdown' counts down (basketball).
        timerMode: 'stopwatch',
          // 'automatic' starts added time at regulation; 'approval' waits for GO AHEAD.
          additionalTimeMode: 'automatic',
        periodLabel: '1st Half',
        // The "set time": minutes the clock runs before additional/stoppage time.
        regulationMinutes: 90
      },
      hotkeys: { garnetGoal: 'KeyG', topazGoal: 'KeyT', quickReplay: 'KeyR', returnLive: 'KeyL', underReview: 'KeyU', hideLowerThird: 'KeyH', clockToggle: 'Space', sequencePrevious: 'BracketLeft', sequenceNext: 'BracketRight' },
      goalWorkflow: {
        showGoalAnimation: true,
        goalAnimationDuration: 3.0,
        celebrationDurationSeconds: 3.0,
        captureReplayOnGoal: true,
        replaySourceId: '',
        autoReturnLive: true
      }
    };
    return this.config;
  }

  get(key) {
    if (!key) return this.config;
    return key.split('.').reduce((obj, k) => (obj && obj[k] !== undefined) ? obj[k] : undefined, this.config);
  }

  set(key, value) {
    const keys = key.split('.');
    let target = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!target[keys[i]]) target[keys[i]] = {};
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = value;
    const ok = this.save();
    this.emit('changed', { key, value, config: this.config });
    return ok;
  }

  updateAll(newConfig) {
    this.config = { ...this.config, ...newConfig };
    const ok = this.save();
    this.emit('changed', { key: '*', value: this.config, config: this.config });
    return ok;
  }

  _preserveCorruptFile(err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.configPath}.corrupt-${stamp}`;
    const info = {
      message: (err && err.message) || String(err),
      configPath: this.configPath,
      backupPath: null,
      at: Date.now()
    };
    try {
      fs.copyFileSync(this.configPath, backupPath);
      info.backupPath = backupPath;
    } catch (copyErr) {
      info.backupError = copyErr.message;
    }
    return info;
  }

  getStatus() {
    return {
      loadError: this.loadError ? { ...this.loadError } : null,
      lastSaveError: this.lastSaveError || null,
      writesBlocked: !!this._writeBlocked
    };
  }

  save() {
    if (this._writeBlocked) {
      this.lastSaveError = 'Configuration could not be read safely, so saving is disabled to protect the existing file.';
      console.error('[ConfigManager] Save skipped:', this.lastSaveError);
      return false;
    }
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Keep the last known-good file once per session before the first overwrite.
      if (!this._sessionBackupDone && fs.existsSync(this.configPath) && !this.loadError) {
        try {
          fs.copyFileSync(this.configPath, `${this.configPath}.bak`);
        } catch (bakErr) {
          console.warn('[ConfigManager] Could not write .bak copy:', bakErr.message);
        }
        this._sessionBackupDone = true;
      }

      // Write to a temp file then rename so an interrupted write cannot leave a
      // half-written bos.json behind.
      const tmpPath = `${this.configPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.config, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.configPath);
      this.lastSaveError = null;
      return true;
    } catch (err) {
      this.lastSaveError = err.message;
      console.error('[ConfigManager] Failed to save config:', err.message);
      return false;
    }
  }
}

module.exports = ConfigManager;
