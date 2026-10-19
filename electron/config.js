const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ConfigManager extends EventEmitter {
  constructor(configPath) {
    super();
    this.configPath = configPath || path.join(__dirname, '..', 'config', 'bos.json');
    this.config = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(data);
        return this.config;
      }
    } catch (err) {
      console.error('[ConfigManager] Failed to read config:', err);
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
      graphics: { httpPort: 8088, wsPort: 8088, defaultLowerThirdDuration: 5, animationStyle: 'slide-in', lowerThirdColor: '#eab308', remoteImmediateScore: false },
      transitions: { defaultTransition: 'Fade', durationMs: 300 },
      match: {
        // 'stopwatch' counts up to the set time (football), 'countdown' counts down (basketball).
        timerMode: 'stopwatch',
          // 'automatic' starts added time at regulation; 'approval' waits for GO AHEAD.
          additionalTimeMode: 'automatic',
        bestOfSets: 3,
        completedSets: [],
        homeSetsWon: 0,
        awaySetsWon: 0,
        periodLabel: '1st Half',
        // The "set time": minutes the clock runs before additional/stoppage time.
        regulationMinutes: 90,
        offenseSeconds: 24,
        offenseTimerSeconds: 24
      },
      hotkeys: { garnetGoal: 'KeyG', topazGoal: 'KeyT', quickReplay: 'KeyR', returnLive: 'KeyL', underReview: 'KeyU', hideLowerThird: 'KeyH', clockToggle: 'Space', sequencePrevious: 'BracketLeft', sequenceNext: 'BracketRight' },
      goalWorkflow: {
        showGoalAnimation: true,
        goalAnimationDuration: 3.0,
        celebrationDurationSeconds: 3.0,
        captureReplayOnGoal: false,
        replaySourceId: '',
        homeGoalActionLabel: 'GOAL',
        awayGoalActionLabel: 'GOAL',
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
    this.save();
    this.emit('changed', { key, value, config: this.config });
  }

  updateAll(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.save();
    this.emit('changed', { key: '*', value: this.config, config: this.config });
  }

  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[ConfigManager] Failed to save config:', err);
      return false;
    }
  }
}

module.exports = ConfigManager;
