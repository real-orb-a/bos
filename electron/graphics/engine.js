const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');
const EventEmitter = require('events');

const ScoreGraphicsController = require('./score');
const GoalGraphicsController = require('./goal');
const LowerThirdGraphicsController = require('./lowerThird');
const MessagesManager = require('./messages');

class GraphicsEngine extends EventEmitter {
  constructor(configManager, scoreManager, matchEngine) {
    super();
    this.config = configManager;
    this.scoreManager = scoreManager;
    this.matchEngine = matchEngine;

    this.scoreGraphics = new ScoreGraphicsController(scoreManager, matchEngine);
    this.goalGraphics = new GoalGraphicsController(configManager);
    this.lowerThird = new LowerThirdGraphicsController(configManager);
    this.messages = new MessagesManager();
    this.queueProcessing = false;

    this.httpServer = null;
    this.wss = null;
    this.port = this.config.get('graphics.httpPort') ?? 8088;
    this.remoteControlPassword = this.config.get('graphics.remoteControlKey');
    if (typeof this.remoteControlPassword !== 'string' || this.remoteControlPassword.length < 8) {
      this.remoteControlPassword = crypto.randomBytes(24).toString('hex');
      this.config.set('graphics.remoteControlKey', this.remoteControlPassword);
    }
    this.remoteImmediateScore = this.config.get('graphics.remoteImmediateScore') === true;
    this.pendingRemoteScoreProposals = new Map();
    this.connectedClients = new Set();
    this.replayOverlayActive = false;
    this.replayOverlayData = null;
    this.scorebugVisible = true;
    this.topMessageActive = false;
    this.topMessageData = null;

    // Pending score animation requested by a workflow before the score changes,
    // so the scoreChanged listener broadcasts a single clean animation event.
    this._pendingScoreAnimation = null;

    this._bindSubsystems();
    this.startServer();
  }

  _bindSubsystems() {
    this.messages.on('queueUpdated', () => {
      this.emit('queueUpdated', this.messages.getQueueState());
    });

    this.lowerThird.on('show', (payload) => {
      this.messages.activeGraphic = {
        title: payload.data.title,
        subtitle: payload.data.subtitle,
        duration: payload.data.duration,
        remainingSeconds: payload.data.duration
      };
      this.broadcast(payload);
      this.emit('queueUpdated', this.messages.getQueueState());
    });

    this.lowerThird.on('tick', ({ remainingSeconds }) => {
      if (this.messages.activeGraphic) {
        this.messages.activeGraphic.remainingSeconds = remainingSeconds;
        this.emit('queueUpdated', this.messages.getQueueState());
      }
    });

    this.lowerThird.on('hide', (payload) => {
      this.messages.activeGraphic = null;
      this.broadcast(payload);
      this.emit('queueUpdated', this.messages.getQueueState());
      // Process next queued item if available
      this._processNextInQueue();
    });

    this.scoreManager.on('scoreChanged', (data) => {
      const animation = this._pendingScoreAnimation || 'pop';
      this._pendingScoreAnimation = null;
      this.broadcastScoreUpdate(animation, data.team);
    });

    this.scoreManager.on('teamsUpdated', () => {
      this.broadcastScoreUpdate('update', 'both');
    });

    this.matchEngine.on('clockTick', (clock) => this._broadcastClockUpdate(clock));
    this.matchEngine.on('clockChanged', (clock) => this._broadcastClockUpdate(clock));
    this.matchEngine.on('setsChanged', (sets) => this.broadcast({ type: 'SETS_UPDATE', sets }));
    this.matchEngine.on('offenseTick', (offense) => this._broadcastOffenseUpdate(offense));
    this.matchEngine.on('offenseChanged', (offense) => this._broadcastOffenseUpdate(offense));
  }

  _broadcastClockUpdate(clock) {
    this.broadcast({ type: 'CLOCK_UPDATE', clock });
  }

  _broadcastOffenseUpdate(offense) {
    this.broadcast({ type: 'OFFENSE_UPDATE', offense });
  }

  getRemoteControlInfo() {
    const addresses = Object.values(os.networkInterfaces())
      .flatMap((interfaces) => interfaces || [])
      .filter((address) => address.family === 'IPv4' && !address.internal)
      .map((address) => address.address);
    return {
      port: this.port,
      password: this.remoteControlPassword,
      immediateScore: this.remoteImmediateScore,
      addresses
    };
  }

  setRemoteImmediateScore(enabled) {
    const nextValue = !!enabled;
    const config = this.config.get();
    const graphicsConfig = config.graphics || (config.graphics = {});
    const previousValue = graphicsConfig.remoteImmediateScore;
    graphicsConfig.remoteImmediateScore = nextValue;
    if (!this.config.save()) {
      if (previousValue === undefined) {
        delete graphicsConfig.remoteImmediateScore;
      } else {
        graphicsConfig.remoteImmediateScore = previousValue;
      }
      throw new Error('Could not save the score update setting. Check the configuration file permissions.');
    }
    this.remoteImmediateScore = nextValue;
    this.broadcast({ type: 'REMOTE_SCORE_MODE', immediate: this.remoteImmediateScore });
    return this.remoteImmediateScore;
  }

  getRemoteScoreProposals() {
    return Array.from(this.pendingRemoteScoreProposals.values(), proposal => ({ ...proposal }));
  }

  submitRemoteScoreProposal(ws, command) {
    const validDelta = value => Number.isSafeInteger(value) && Math.abs(value) <= 1000;
    if (!validDelta(command.homeDelta) || !validDelta(command.awayDelta) ||
        (command.homeDelta === 0 && command.awayDelta === 0)) {
      throw new Error('Score request must include a valid non-zero change.');
    }
    if (this.pendingRemoteScoreProposals.size >= 100) {
      throw new Error('Too many score requests are awaiting approval.');
    }

    const proposal = {
      id: crypto.randomUUID(),
      homeDelta: command.homeDelta,
      awayDelta: command.awayDelta,
      submittedAt: Date.now(),
      clientAddress: ws._socket?.remoteAddress || 'Browser remote'
    };
    this.pendingRemoteScoreProposals.set(proposal.id, proposal);
    this._broadcastRemoteScoreProposals();
    return proposal;
  }

  approveRemoteScoreProposal(id) {
    const proposal = this.pendingRemoteScoreProposals.get(id);
    if (!proposal) throw new Error('That score request is no longer awaiting approval.');

    const score = this.scoreManager.getScore();
    this.scoreManager.setScore(
      score.home.score + proposal.homeDelta,
      score.away.score + proposal.awayDelta
    );
    this.pendingRemoteScoreProposals.delete(id);
    this._broadcastRemoteScoreProposals();
    return this.getRemoteScoreProposals();
  }

  rejectRemoteScoreProposal(id) {
    if (!this.pendingRemoteScoreProposals.has(id)) {
      throw new Error('That score request is no longer awaiting approval.');
    }
    this.pendingRemoteScoreProposals.delete(id);
    this._broadcastRemoteScoreProposals();
    return this.getRemoteScoreProposals();
  }

  _broadcastRemoteScoreProposals() {
    const proposals = this.getRemoteScoreProposals();
    this.emit('remoteScoreProposalsChanged', proposals);
    this.broadcast({ type: 'REMOTE_SCORE_PROPOSALS', proposals });
  }

  setRemoteControlPassword(password) {
    if (typeof password !== 'string' || password.trim().length < 8) {
      throw new Error('Remote password must be at least 8 characters.');
    }

    const nextPassword = password.trim();
    const config = this.config.get();
    const graphicsConfig = config.graphics || (config.graphics = {});
    const previousConfigPassword = graphicsConfig.remoteControlKey;
    graphicsConfig.remoteControlKey = nextPassword;
    if (!this.config.save()) {
      if (previousConfigPassword === undefined) {
        delete graphicsConfig.remoteControlKey;
      } else {
        graphicsConfig.remoteControlKey = previousConfigPassword;
      }
      throw new Error('Could not save the remote password. Check the configuration file permissions.');
    }

    this.remoteControlPassword = nextPassword;
    for (const client of this.connectedClients) {
      if (client.remoteControlClient && client.readyState === WebSocket.OPEN) {
        client.remoteAuthenticated = false;
        client.send(JSON.stringify({ type: 'REMOTE_AUTH_REQUIRED' }));
      }
    }
    return this.getRemoteControlInfo();
  }

  _isRemoteControlKeyValid(candidate) {
    if (typeof candidate !== 'string') return false;
    const provided = Buffer.from(candidate);
    const expected = Buffer.from(this.remoteControlPassword);
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  }

  _handleRemoteCommand(ws, command) {
    if (!ws.remoteAuthenticated) {
      ws.send(JSON.stringify({
        type: 'REMOTE_COMMAND_RESULT',
        action: command.action,
        ok: false,
        error: 'Authenticate before sending controls.'
      }));
      return;
    }

    try {
      switch (command.action) {
        case 'SCORE_ADJUST': {
          if (!this.remoteImmediateScore) {
            throw new Error('Immediate score updates are disabled in BOS.');
          }
          if (!['home', 'away'].includes(command.team) || ![-1, 1].includes(command.amount)) {
            throw new Error('Invalid score adjustment.');
          }
          const method = command.team === 'home'
            ? (command.amount > 0 ? 'addHome' : 'subtractHome')
            : (command.amount > 0 ? 'addAway' : 'subtractAway');
          this.scoreManager[method](1);
          break;
        }
        case 'SCORE_PROPOSAL': {
          if (this.remoteImmediateScore) {
            throw new Error('Score changes are immediate; proposals are disabled.');
          }
          const proposal = this.submitRemoteScoreProposal(ws, command);
          ws.send(JSON.stringify({
            type: 'REMOTE_COMMAND_RESULT',
            action: command.action,
            ok: true,
            proposalId: proposal.id
          }));
          return;
        }
        case 'CLOCK_TOGGLE':
          this.matchEngine.toggleClock();
          break;
        case 'CLOCK_RESET':
          this.matchEngine.resetClock();
          break;
        case 'CLOCK_SET': {
          const seconds = Number(command.seconds);
          if (!Number.isSafeInteger(seconds) || seconds < 0 ||
              seconds > this.matchEngine.getClockState().regulationSeconds) {
            throw new Error('Clock time must be within the configured match length.');
          }
          this.matchEngine.setClock({ seconds });
          break;
        }
        case 'CLOCK_SET_START': {
          const seconds = Number(command.seconds);
          if (!Number.isSafeInteger(seconds) || seconds < 0 ||
              seconds > this.matchEngine.getClockState().regulationSeconds) {
            throw new Error('Start time must be within the configured match length.');
          }
          this.matchEngine.setStartTime(seconds);
          break;
        }
        case 'CLOCK_SET_PERIOD': {
          const period = typeof command.period === 'string' ? command.period.trim() : '';
          if (!period || period.length > 24) {
            throw new Error('Period label must contain 1 to 24 characters.');
          }
          this.matchEngine.setPeriod(period);
          break;
        }
        case 'OFFENSE_TOGGLE':
          this.matchEngine.toggleOffenseClock();
          break;
        case 'OFFENSE_RESET':
          this.matchEngine.resetOffenseClock();
          break;
        default:
          throw new Error('Unknown remote control action.');
      }
      ws.send(JSON.stringify({ type: 'REMOTE_COMMAND_RESULT', action: command.action, ok: true }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'REMOTE_COMMAND_RESULT',
        action: command.action,
        ok: false,
        error: error.message
      }));
    }
  }

  _processNextInQueue() {
    if (this.queueProcessing || this.lowerThird.isVisible) return;
    const next = this.messages.dequeue();
    if (next) {
      this.queueProcessing = true;
      setTimeout(() => {
        this.queueProcessing = false;
        this.lowerThird.show(next);
      }, 500);
    }
  }

  enqueueMessage(item) {
    const queued = this.messages.enqueue(item);
    this._processNextInQueue();
    return queued;
  }

  startServer() {
    const rootDir = path.resolve(__dirname, '..', '..');

    this.httpServer = http.createServer((req, res) => {
      // Basic static file server for /graphics and /media
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      let reqPath = parsedUrl.pathname;

      if (reqPath === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>BOS Graphics Engine</title><style>body{font-family:sans-serif;background:#0f172a;color:#fff;padding:40px;line-height:1.6}a{color:#38bdf8;text-decoration:none;font-weight:bold;font-size:18px}li{margin:12px 0}</style></head>
          <body>
            <h1>BOS Broadcast Graphics Server</h1>
            <p>Active Browser Sources for OBS Studio:</p>
            <ul>
              <li><a href="/graphics/score/" target="_blank">Score Bug (/graphics/score/)</a></li>
              <li><a href="/remote/" target="_blank">Key-Protected Browser Remote (/remote/)</a></li>
              <li><a href="/graphics/goal/" target="_blank">Goal Celebration (/graphics/goal/)</a></li>
              <li><a href="/graphics/lower-third/" target="_blank">Lower Third & F1 Review (/graphics/lower-third/)</a></li>
              <li><a href="/graphics/top-message/" target="_blank">Top Message (/graphics/top-message/)</a></li>
              <li><a href="/graphics/replay/" target="_blank">Replay Overlay (/graphics/replay/)</a></li>
            </ul>
          </body>
          </html>
        `);
        return;
      }

      // Safe path resolution
      let localPath = path.join(rootDir, reqPath);

      // Check if it's a directory, append index.html
      if (fs.existsSync(localPath) && fs.statSync(localPath).isDirectory()) {
        localPath = path.join(localPath, 'index.html');
      }

      if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(localPath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4'
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });

      fs.createReadStream(localPath).pipe(res);
    });

    this.wss = new WebSocket.Server({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      this.connectedClients.add(ws);
      ws.remoteAuthenticated = false;
      console.log(`[GraphicsEngine] Client connected. Total clients: ${this.connectedClients.size}`);

      // Send initial full sync
      const initPayload = {
        type: 'INITIAL_SYNC',
        score: this.scoreGraphics.getPayload(),
        remoteImmediateScore: this.remoteImmediateScore,
        remoteScoreProposals: this.getRemoteScoreProposals(),
        lowerThird: this.lowerThird.getState(),
        topMessage: {
          active: this.topMessageActive,
          data: this.topMessageData
        },
        offense: this.matchEngine.getOffenseClockState(),
        replayOverlay: {
          active: this.replayOverlayActive,
          data: this.replayOverlayData
        },
        scorebugVisible: this.scorebugVisible
      };
      ws.send(JSON.stringify(initPayload));

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed.type === 'REMOTE_AUTH') {
            ws.remoteControlClient = true;
            const authenticated = this._isRemoteControlKeyValid(parsed.password);
            ws.remoteAuthenticated = authenticated;
            ws.send(JSON.stringify({ type: 'REMOTE_AUTH_RESULT', authenticated }));
          } else if (parsed.type === 'REMOTE_COMMAND') {
            this._handleRemoteCommand(ws, parsed);
          } else if (parsed.type === 'TRANSITION_COVERED') {
            this.emit('transitionCovered', parsed);
          } else if (parsed.type === 'TRANSITION_FINISHED') {
            this.emit('transitionFinished', parsed);
          }
        } catch (e) {
          // ignore non-json
        }
      });

      ws.on('close', () => {
        this.connectedClients.delete(ws);
        console.log(`[GraphicsEngine] Client disconnected. Total: ${this.connectedClients.size}`);
      });
    });

    this.httpServer.listen(this.port, () => {
      this.port = this.httpServer.address().port;
      console.log(`[GraphicsEngine] Server listening at http://localhost:${this.port}`);
    });
  }

  triggerTransition(data = {}) {
    const payload = {
      type: 'TRIGGER_TRANSITION',
      data: {
        id: data.id || `trans_${Date.now()}`,
        title: data.title || 'REPLAY',
        ...data
      }
    };
    this.broadcast(payload);
    return payload.data.id;
  }

  broadcast(message) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const client of this.connectedClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  broadcastScoreUpdate(animationType = 'pop', changedTeam = null) {
    const payload = this.scoreGraphics.getPayload(animationType, changedTeam);
    this.broadcast(payload);
  }

  setScorebugVisible(visible) {
    this.scorebugVisible = !!visible;
    this.broadcast({
      type: 'SCOREBUG_VISIBILITY',
      visible: this.scorebugVisible
    });
    return this.scorebugVisible;
  }

  // Used by workflows to choose the score animation before the score actually
  // changes. The scoreChanged listener consumes this once, then resets it.
  queueScoreAnimation(animationType) {
    this._pendingScoreAnimation = animationType || 'pop';
  }

  triggerGoalAnimation(team, options = {}) {
    const payload = this.goalGraphics.getPayload(team, this.scoreManager.getScore(), options);
    this.broadcast(payload);
    return payload;
  }

  showLowerThird(data) {
    return this.lowerThird.show(data);
  }

  hideLowerThird() {
    return this.lowerThird.hide();
  }

  // ---- Top message (an upper-third mirror of the lower third) ----

  showTopMessage(data = {}) {
    this.topMessageActive = true;
    this.topMessageData = {
      title: data.title || 'MESSAGE',
      subtitle: data.subtitle || '',
      badge: data.badge || '',
      value: data.value || '',
      duration: data.duration !== undefined ? data.duration : (this.config.get('graphics.defaultLowerThirdDuration') || 5),
      // Centred at the top by default, like the race-control banner reference.
      position: data.position || 'top-center',
      style: data.style || 'standard',
      color: data.color || this.config.get('graphics.lowerThirdColor') || '',
      timestamp: Date.now()
    };
    this.broadcast({
      type: 'TOP_MESSAGE_SHOW',
      data: this.topMessageData
    });
    return this.topMessageData;
  }

  hideTopMessage() {
    this.topMessageActive = false;
    this.topMessageData = null;
    this.broadcast({ type: 'TOP_MESSAGE_HIDE', timestamp: Date.now() });
  }

  showReplayOverlay(data) {
    this.replayOverlayActive = true;
    this.replayOverlayData = data;
    this.broadcast({
      type: 'REPLAY_OVERLAY_SHOW',
      data
    });
  }

  hideReplayOverlay() {
    this.replayOverlayActive = false;
    this.replayOverlayData = null;
    this.broadcast({
      type: 'REPLAY_OVERLAY_HIDE'
    });
  }

  destroy() {
    if (this.wss) {
      this.wss.close();
    }
    if (this.httpServer) {
      this.httpServer.close();
    }
  }
}

module.exports = GraphicsEngine;
