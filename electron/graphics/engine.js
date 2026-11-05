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
    this.serverStatus = { state: 'starting', port: this.port, error: '' };
    this.remoteControlPassword = this.config.get('graphics.remoteControlKey');
    if (typeof this.remoteControlPassword !== 'string' || this.remoteControlPassword.length < 8) {
      this.remoteControlPassword = crypto.randomBytes(24).toString('hex');
      this.config.set('graphics.remoteControlKey', this.remoteControlPassword);
    }
    this.remoteImmediateScore = this.config.get('graphics.remoteImmediateScore') === true;
    this.remoteAthleticsReorderHandler = null;
    this.remoteAthleticsBatonTransferHandler = null;
    this.pendingRemoteScoreProposals = new Map();
    this.connectedClients = new Set();
    this.replayOverlayActive = false;
    this.replayOverlayData = null;
    this.scorebugVisible = true;
    this.scorebugExpanded = false;
    this.athleticsRelayMode = 'compact';
    this.athleticsRelayEventId = null;
    this.athleticsRelayRunnerIndexes = {};
    this.scorebugMatchName = '';
    this.sportScorebug = null;
    this.screenCenterScorebugVisible = false;
    this.centerScorebugTimer = null;
    this.cornerScorebugTimer = null;
    this.centerScorebugTransitionId = 0;
    this.athleticsStandings = { active: false, event: null, houses: [] };
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
            throw new Error('Immediate score updates are disabled in SLC.');
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
        case 'ATHLETICS_REORDER': {
          if (typeof this.remoteAthleticsReorderHandler !== 'function') {
            throw new Error('Athletics race order is unavailable.');
          }
          this.remoteAthleticsReorderHandler(command.resultIds);
          break;
        }
        case 'ATHLETICS_BATON_TRANSFER':
          this.transferAthleticsBaton(command.resultId);
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

  startServer(requestedPort = this.port) {
    this.serverStatus = { state: 'starting', port: requestedPort, error: '' };
    this.emit('serverStatusChanged', this.getServerStatus());
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
          <head><title>SLC Graphics Engine</title><style>body{font-family:sans-serif;background:#0f172a;color:#fff;padding:40px;line-height:1.6}a{color:#38bdf8;text-decoration:none;font-weight:bold;font-size:18px}li{margin:12px 0}</style></head>
          <body>
            <h1>SLC Broadcast Graphics Server</h1>
            <p>Active Browser Sources for OBS Studio:</p>
            <ul>
              <li><a href="/graphics/score/" target="_blank">Score Bug (/graphics/score/)</a></li>
              <li><a href="/graphics/screen-center-scorebug/" target="_blank">Screen Center Scorebug (/graphics/screen-center-scorebug/)</a></li>
              <li><a href="/graphics/basketball/" target="_blank">Basketball Score Bug (/graphics/basketball/)</a></li>
              <li><a href="/graphics/volleyball/" target="_blank">Volleyball Score Bug (/graphics/volleyball/)</a></li>
              <li><a href="/graphics/transitions/" target="_blank">Transitions (/graphics/transitions/)</a></li>
              <li><a href="/graphics/goal/" target="_blank">Goal Celebration (/graphics/goal/)</a></li>
              <li><a href="/graphics/lower-third/" target="_blank">Lower Third & F1 Review (/graphics/lower-third/)</a></li>
              <li><a href="/graphics/top-message/" target="_blank">Top Message (/graphics/top-message/)</a></li>
              <li><a href="/graphics/replay/" target="_blank">Replay Overlay (/graphics/replay/)</a></li>
              <li><a href="/remote/" target="_blank">Key-Protected Browser Remote (/remote/)</a></li>
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
    // The WebSocket server re-emits HTTP server errors; consume that event so
    // EADDRINUSE can be reported to the app instead of becoming an uncaught error.
    this.wss.on('error', () => {});

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
        scorebugVisible: this.scorebugVisible,
        scorebugExpanded: this.scorebugExpanded,
        athleticsRelayMode: this.athleticsRelayMode,
        athleticsRelayRunnerIndexes: this.athleticsRelayRunnerIndexes,
        scorebugMatchName: this.scorebugMatchName,
        screenCenterScorebugVisible: this.screenCenterScorebugVisible,
        sportScorebug: this.sportScorebug,
        athleticsStandings: this.athleticsStandings
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

    const server = this.httpServer;
    server.on('error', error => {
      if (server !== this.httpServer) return;
      const state = error.code === 'EADDRINUSE' ? 'port-conflict' : 'error';
      this.serverStatus = { state, port: requestedPort, error: error.message };
      this.emit('serverStatusChanged', this.getServerStatus());
      console.error(`[GraphicsEngine] Server failed on port ${requestedPort}:`, error.message);
    });
    server.listen(requestedPort, () => {
      if (server !== this.httpServer) return;
      this.port = server.address().port;
      this.serverStatus = { state: 'running', port: this.port, error: '' };
      this.emit('serverStatusChanged', this.getServerStatus());
      console.log(`[GraphicsEngine] Server listening at http://localhost:${this.port}`);
    });
  }

  getServerStatus() {
    return { ...this.serverStatus };
  }

  async setServerPort(port) {
    const nextPort = Number(port);
    if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
      throw new Error('Enter a port number from 1024 to 65535.');
    }
    const previousServer = this.httpServer;
    const previousWebSocketServer = this.wss;
    if (previousWebSocketServer) {
      previousWebSocketServer.clients.forEach(client => client.terminate());
      await new Promise(resolve => {
        try { previousWebSocketServer.close(resolve); } catch (_) { resolve(); }
      });
    }
    if (previousServer?.listening) {
      await new Promise(resolve => previousServer.close(resolve));
    }
    this.connectedClients.clear();

    return new Promise(resolve => {
      const onStatus = status => {
        if (status.state === 'starting') return;
        this.removeListener('serverStatusChanged', onStatus);
        if (status.state === 'running') this.config.set('graphics.httpPort', nextPort);
        resolve(status);
      };
      this.on('serverStatusChanged', onStatus);
      this.startServer(nextPort);
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
    payload.sportScorebug = this.sportScorebug;
    this.broadcast(payload);
  }

  setSportScorebugState(session) {
    this.sportScorebug = null;
    if (session?.modeId === 'volleyball') {
      const state = session.sportState || {};
      const homeSets = state.sets?.home || 0;
      const awaySets = state.sets?.away || 0;
      const bestOf = state.bestOf || 5;
      const score = this.scoreManager.getScore();
      this.sportScorebug = {
        mode: 'volleyball',
        homeName: session.teams.home.name,
        awayName: session.teams.away.name,
        homeScore: score.home.score,
        awayScore: score.away.score,
        homeSets,
        awaySets,
        target: homeSets + awaySets >= bestOf - 1
          ? (state.decidingSetPointsToWin || 15)
          : (state.pointsToWin || 25),
        pointsToWinBy: state.pointsToWinBy || 2
      };
    } else if (session?.modeId === 'cricket') {
      const state = session.sportState || {};
      this.sportScorebug = {
        mode: 'cricket',
        period: state.period || '1st Innings',
        homeWickets: state.wickets?.home || 0,
        awayWickets: state.wickets?.away || 0,
        homeOvers: state.overs?.home || 0,
        awayOvers: state.overs?.away || 0
      };
    } else if (['table-tennis', 'badminton'].includes(session?.modeId)) {
      const state = session.sportState || {};
      this.sportScorebug = {
        mode: session.modeId,
        homeName: session.teams.home.name,
        awayName: session.teams.away.name,
        homeShort: session.teams.home.shortName,
        awayShort: session.teams.away.shortName,
        target: state.pointsToWin || (session.modeId === 'badminton' ? 21 : 11),
        pointsToWinBy: state.pointsToWinBy || 2,
        homeSets: state.sets?.home || 0,
        awaySets: state.sets?.away || 0,
        matchFormat: state.racketMatch?.format || 'singles',
        homePlayers: state.racketMatch?.players?.home || [],
        awayPlayers: state.racketMatch?.players?.away || []
      };
    }
    this.broadcast({ type: 'SPORT_SCOREBUG_UPDATE', sportScorebug: this.sportScorebug });
    return this.sportScorebug;
  }

  setScorebugVisible(visible) {
    const next = !!visible;
    if (next && (this.screenCenterScorebugVisible || this.centerScorebugTimer || this.cornerScorebugTimer)) {
      return false;
    }
    const changed = next !== this.scorebugVisible;
    this.scorebugVisible = next;

    // Mutual exclusion: if the normal score bug is being faded in while the
    // center score bug is visible, fade the center one out first.
    if (changed && next && this.screenCenterScorebugVisible) {
      this.screenCenterScorebugVisible = false;
      this.broadcast({
        type: 'SCREEN_CENTER_SCOREBUG_VISIBILITY',
        visible: false
      });
    }

    this.broadcast({
      type: 'SCOREBUG_VISIBILITY',
      visible: this.scorebugVisible
    });
    this.emit('scorebugVisibilityChanged', this.scorebugVisible);
    return this.scorebugVisible;
  }

  setScorebugExpanded(expanded) {
    if (this.screenCenterScorebugVisible) return false;
    this.scorebugExpanded = !!expanded;
    if (this.athleticsStandings?.event?.category === 'relay') {
      this.athleticsRelayMode = this.scorebugExpanded ? 'expanded' : 'compact';
    }
    this.broadcast({ type: 'SCOREBUG_EXPANSION', expanded: this.scorebugExpanded, athleticsRelayMode: this.athleticsRelayMode });
    return this.scorebugExpanded;
  }

  setAthleticsRelayMode(mode) {
    if (!['compact', 'expanded', 'team'].includes(mode)) throw new Error('Choose compact, expanded, or full-team relay display.');
    if (this.screenCenterScorebugVisible) return this.athleticsRelayMode;
    this.athleticsRelayMode = mode;
    this.scorebugExpanded = mode !== 'compact';
    this.broadcast({ type: 'SCOREBUG_EXPANSION', expanded: this.scorebugExpanded, athleticsRelayMode: mode });
    return this.athleticsRelayMode;
  }

  resetAthleticsScorebug() {
    ++this.centerScorebugTransitionId;
    clearTimeout(this.centerScorebugTimer);
    clearTimeout(this.cornerScorebugTimer);
    this.centerScorebugTimer = null;
    this.cornerScorebugTimer = null;
    this.screenCenterScorebugVisible = false;
    this.scorebugVisible = true;
    this.scorebugExpanded = true;
    this.athleticsRelayMode = 'compact';
    this.athleticsRelayEventId = null;
    this.broadcast({ type: 'SCREEN_CENTER_SCOREBUG_VISIBILITY', visible: false });
    this.broadcast({ type: 'SCOREBUG_VISIBILITY', visible: true });
    this.broadcast({ type: 'SCOREBUG_EXPANSION', expanded: true, athleticsRelayMode: this.athleticsRelayMode });
    this.emit('screenCenterScorebugChanged', false);
    this.emit('scorebugVisibilityChanged', true);
    return true;
  }

  // Screen center scorebug: a separate browser-source graphic that phases in
  // from the center of the screen. When it is shown the regular (corner) score
  // bug fades out, and when it fades out the corner score bug comes back — so
  // the two are mutually exclusive and both stay in sync via the same WS state.
  setScreenCenterScorebugVisible(visible) {
    const next = !!visible;
    if (next && this.screenCenterScorebugVisible) return true;
    const transitionId = ++this.centerScorebugTransitionId;
    clearTimeout(this.centerScorebugTimer);
    clearTimeout(this.cornerScorebugTimer);
    this.centerScorebugTimer = null;
    this.cornerScorebugTimer = null;

    if (next) {
      this.screenCenterScorebugVisible = true;
      this.scorebugExpanded = false;
      this.broadcast({ type: 'SCOREBUG_EXPANSION', expanded: false });
      this.setScorebugVisible(false);
      this.broadcast({ type: 'SCREEN_CENTER_SCOREBUG_VISIBILITY', visible: true });
      this.emit('screenCenterScorebugChanged', true);
      // Start expanding as the fade begins, so it animates from compact instead
      // of appearing at full size or waiting until the fade has finished.
      this.centerScorebugTimer = setTimeout(() => {
        if (transitionId !== this.centerScorebugTransitionId || !this.screenCenterScorebugVisible) return;
        this.centerScorebugTimer = null;
        this.scorebugExpanded = true;
        this.broadcast({ type: 'SCOREBUG_EXPANSION', expanded: true });
      }, 50);
      return true;
    }

    if (!this.screenCenterScorebugVisible) return false;
    // Collapse first, hold the compact center bug for half a second, then fade it
    // out. Restore the corner bug 700ms after that fade begins.
    this.scorebugExpanded = false;
    this.broadcast({ type: 'SCOREBUG_EXPANSION', expanded: false });
    this.centerScorebugTimer = setTimeout(() => {
      if (transitionId !== this.centerScorebugTransitionId) return;
      this.centerScorebugTimer = null;
      this.screenCenterScorebugVisible = false;
      this.broadcast({ type: 'SCREEN_CENTER_SCOREBUG_VISIBILITY', visible: false });
      this.emit('screenCenterScorebugChanged', false);
      this.cornerScorebugTimer = setTimeout(() => {
        if (transitionId !== this.centerScorebugTransitionId) return;
        this.cornerScorebugTimer = null;
        this.scorebugVisible = true;
        this.broadcast({ type: 'SCOREBUG_VISIBILITY', visible: true });
        this.emit('scorebugVisibilityChanged', true);
      }, 700);
    }, 500);
    return true;
  }

  setScorebugMatchName(name) {
    if (typeof name !== 'string' || name.length > 120) {
      throw new Error('Scorebug match name must be 120 characters or fewer.');
    }
    this.scorebugMatchName = name.trim();
    this.broadcast({ type: 'SCOREBUG_MATCH_NAME', name: this.scorebugMatchName });
    return this.scorebugMatchName;
  }

  setAthleticsStandings(standings) {
    if (!standings || typeof standings !== 'object') {
      throw new Error('Athletics standings state must be an object.');
    }
    this.athleticsStandings = JSON.parse(JSON.stringify(standings));
    if (standings.event?.category === 'relay') {
      if (this.athleticsRelayEventId !== standings.event.id) {
        this.athleticsRelayEventId = standings.event.id;
        this.athleticsRelayRunnerIndexes = {};
        this.athleticsRelayMode = 'compact';
      }
      const validIds = new Set((standings.event.results || []).map(result => result.id));
      for (const id of Object.keys(this.athleticsRelayRunnerIndexes)) {
        if (!validIds.has(id)) delete this.athleticsRelayRunnerIndexes[id];
      }
      for (const result of standings.event.results || []) {
        const storedIndex = Number.isInteger(result.currentRunnerIndex) ? result.currentRunnerIndex : this.athleticsRelayRunnerIndexes[result.id];
        this.athleticsRelayRunnerIndexes[result.id] = Math.min(
          Math.max(0, Number.isInteger(storedIndex) ? storedIndex : 0),
          Math.max(0, (result.runnerNames || []).length - 1)
        );
      }
      this.scorebugExpanded = this.athleticsRelayMode !== 'compact';
      this.broadcast({ type: 'SCOREBUG_EXPANSION', expanded: this.scorebugExpanded, athleticsRelayMode: this.athleticsRelayMode });
    } else {
      this.athleticsRelayEventId = null;
      this.athleticsRelayRunnerIndexes = {};
    }
    this.broadcast({ type: 'ATHLETICS_STANDINGS_UPDATE', standings: this.athleticsStandings });
    return this.athleticsStandings;
  }

  transferAthleticsBaton(resultId) {
    if (typeof this.remoteAthleticsBatonTransferHandler === 'function') {
      const transfer = this.remoteAthleticsBatonTransferHandler(resultId);
      this.athleticsRelayRunnerIndexes[resultId] = transfer.runnerIndex;
      this.broadcast({
        type: 'ATHLETICS_BATON_TRANSFER',
        eventId: transfer.eventId,
        resultId: transfer.resultId,
        runnerIndex: transfer.runnerIndex,
        nextRunnerName: transfer.nextRunnerName,
        complete: transfer.complete
      });
      // The transfer event drives the visual handoff. Re-broadcasting all
      // standings here would rebuild scorebug/remote rows and erase the arrow
      // before its preview-and-slide animation completes.
      if (transfer.standings) this.athleticsStandings = JSON.parse(JSON.stringify(transfer.standings));
      return {
        runnerIndex: transfer.runnerIndex,
        nextRunnerName: transfer.nextRunnerName,
        complete: transfer.complete
      };
    }
    const event = this.athleticsStandings?.event;
    if (!this.athleticsStandings?.active || this.athleticsStandings.displayMode === 'after' || event?.category !== 'relay') {
      throw new Error('Baton transfer is only available during a live relay.');
    }
    const result = (event.results || []).find(item => item.id === resultId);
    if (!result || !Array.isArray(result.runnerNames) || result.runnerNames.length < 2) {
      throw new Error('This relay team has no next runner to transfer to.');
    }
    const currentIndex = this.athleticsRelayRunnerIndexes[resultId] || 0;
    if (currentIndex >= result.runnerNames.length - 1) {
      throw new Error('This relay team has completed all baton transfers.');
    }
    const index = currentIndex + 1;
    this.athleticsRelayRunnerIndexes[resultId] = index;
    const complete = index === result.runnerNames.length - 1;
    this.broadcast({ type: 'ATHLETICS_BATON_TRANSFER', eventId: event.id, resultId, runnerIndex: index, nextRunnerName: result.runnerNames[index], complete });
    return { runnerIndex: index, nextRunnerName: result.runnerNames[index], complete };
  }

  setRemoteAthleticsReorderHandler(handler) {
    this.remoteAthleticsReorderHandler = typeof handler === 'function' ? handler : null;
  }

  setRemoteAthleticsBatonTransferHandler(handler) {
    this.remoteAthleticsBatonTransferHandler = typeof handler === 'function' ? handler : null;
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
      ...data,
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
