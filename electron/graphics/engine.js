const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const EventEmitter = require('events');
const net = require('net');

const ScoreGraphicsController = require('./score');
const GoalGraphicsController = require('./goal');
const LowerThirdGraphicsController = require('./lowerThird');
const MessagesManager = require('./messages');
const VolleyballGraphicsController = require('./volleyball');
const BasketballGraphicsController = require('./basketball');

class GraphicsEngine extends EventEmitter {
  constructor(configManager, scoreManager, matchEngine, volleyballEngine = null, basketballEngine = null) {
    super();
    this.config = configManager;
    this.scoreManager = scoreManager;
    this.matchEngine = matchEngine;
    this.volleyballEngine = volleyballEngine;
    this.volleyballGraphics = volleyballEngine ? new VolleyballGraphicsController(volleyballEngine) : null;
    this.basketballEngine = basketballEngine;
    this.basketballGraphics = basketballEngine ? new BasketballGraphicsController(basketballEngine) : null;
    const volleyballState = volleyballEngine && volleyballEngine.getState();
    const initialAnnouncement = volleyballState && volleyballState.activeMatch && volleyballState.activeMatch.announcement.live;
    this._lastVolleyballAnnouncementId = initialAnnouncement ? initialAnnouncement.id : null;
    this._lastVolleyballAnnouncementRevision = initialAnnouncement ? initialAnnouncement.revision : 0;
    const basketballState = basketballEngine && basketballEngine.getState();
    const basketballAnnouncement = basketballState && basketballState.match && basketballState.match.announcement.live;
    this._lastBasketballAnnouncementId = basketballAnnouncement ? basketballAnnouncement.id : null;
    this._lastBasketballAnnouncementRevision = basketballAnnouncement ? basketballAnnouncement.revision : 0;

    this.scoreGraphics = new ScoreGraphicsController(scoreManager, matchEngine);
    this.goalGraphics = new GoalGraphicsController(configManager);
    this.lowerThird = new LowerThirdGraphicsController(configManager);
    this.messages = new MessagesManager();

    this.httpServer = null;
    this.wss = null;
    this.port = this.config.get('graphics.httpPort') || 8088;
    this.connectedClients = new Set();
    this.listenError = null;
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
    if (this.volleyballEngine) {
      this.volleyballEngine.on('changed', (state) => this._publishVolleyball(state));
    }
    if (this.basketballEngine) {
      this.basketballEngine.on('changed', (state) => this._publishBasketball(state));
    }
  }

  _publishBasketball(state) {
    try {
      const snapshot = this.basketballGraphics.getSnapshot(state);
      this.broadcast({ type: 'BASKETBALL_STATE_UPDATE', data: snapshot });
      const announcement = snapshot.announcement;
      if (announcement) {
        if (announcement.id !== this._lastBasketballAnnouncementId || announcement.revision !== this._lastBasketballAnnouncementRevision) {
          this.broadcast({ type: 'BASKETBALL_ANNOUNCEMENT_SHOW', data: announcement });
          this._lastBasketballAnnouncementId = announcement.id;
          this._lastBasketballAnnouncementRevision = announcement.revision;
        }
      } else if (this._lastBasketballAnnouncementId) {
        this.broadcast({ type: 'BASKETBALL_ANNOUNCEMENT_CLEAR', revision: snapshot.announcementRevision });
        this._lastBasketballAnnouncementId = null;
        this._lastBasketballAnnouncementRevision = snapshot.announcementRevision;
      }
    } catch (error) {
      console.error('[GraphicsEngine] Basketball broadcast failed:', error.message);
    }
  }

  _publishVolleyball(state) {
    try {
      const snapshot = this.volleyballGraphics.getSnapshot(state);
      this.broadcast({ type: 'VOLLEYBALL_STATE_UPDATE', data: snapshot });
      const announcement = snapshot.announcement;
      if (announcement) {
        if (announcement.id !== this._lastVolleyballAnnouncementId || announcement.revision !== this._lastVolleyballAnnouncementRevision) {
          this.broadcast({ type: 'VOLLEYBALL_ANNOUNCEMENT_SHOW', data: announcement });
          this._lastVolleyballAnnouncementId = announcement.id;
          this._lastVolleyballAnnouncementRevision = announcement.revision;
        }
      } else if (this._lastVolleyballAnnouncementId) {
        this.broadcast({
          type: 'VOLLEYBALL_ANNOUNCEMENT_CLEAR',
          revision: snapshot.announcementRevision
        });
        this._lastVolleyballAnnouncementId = null;
        this._lastVolleyballAnnouncementRevision = snapshot.announcementRevision;
      }
    } catch (error) {
      // A graphics client or formatter failure must not roll back a committed match action.
      console.error('[GraphicsEngine] Volleyball broadcast failed:', error.message);
    }
  }

  _broadcastClockUpdate(clock) {
    this.broadcast({ type: 'CLOCK_UPDATE', clock });
  }

  _processNextInQueue() {
    const next = this.messages.dequeue();
    if (next) {
      setTimeout(() => {
        this.lowerThird.show(next);
      }, 500);
    }
  }

  startServer() {
    const rootDir = path.resolve(__dirname, '..', '..');

    const graphicsRoot = path.join(rootDir, 'graphics');
    const host = this.config.get('graphics.host') || '127.0.0.1';
    const configuredClients = this.config.get('graphics.allowedClients') || [];
    const normalizedHost = String(host).toLowerCase();
    const isLoopbackHost = normalizedHost === 'localhost' || normalizedHost === '::1' || normalizedHost.startsWith('127.');
    const isWildcardHost = normalizedHost === '0.0.0.0' || normalizedHost === '::';
    if (!Array.isArray(configuredClients) || configuredClients.some((address) => !this._normalizeAddress(address))) {
      this.listenError = 'graphics.allowedClients must be an array of valid IP addresses.';
      console.error('[GraphicsEngine] Server not started:', this.listenError);
      return;
    }
    if (!isLoopbackHost && configuredClients.length === 0) {
      this.listenError = 'Non-loopback graphics binding requires an explicit graphics.allowedClients IP allowlist.';
      console.error('[GraphicsEngine] Server not started:', this.listenError);
      return;
    }
    if (!isLoopbackHost && !isWildcardHost && net.isIP(host) === 0) {
      this.listenError = 'LAN graphics.host must be a literal interface IP address.';
      console.error('[GraphicsEngine] Server not started:', this.listenError);
      return;
    }
    this.allowedGraphicsClients = new Set(configuredClients.map((address) => this._normalizeAddress(address)));
    // Only these Browser Source folders and file types are ever served. Nothing
    // outside graphics/ (config, source, credentials, node_modules) is reachable.
    const allowedDirs = new Set(['score', 'goal', 'lower-third', 'replay', 'top-message', 'transitions', 'volleyball', 'basketball']);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4'
    };

    const sendText = (res, status, body, extraHeaders = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
      res.end(body);
    };

    // Returns the absolute file to serve for a request path, or null if not allowed.
    const resolveAllowedFile = (rawPath) => {
      let reqPath;
      try {
        reqPath = decodeURIComponent(rawPath);
      } catch (e) {
        return null;
      }
      if (reqPath.includes('\0') || reqPath.includes('\\') || reqPath.split('/').includes('..')) return null;

      const parts = reqPath.split('/').filter(Boolean);
      if (parts[0] !== 'graphics' || parts.length < 2) return null;
      if (!allowedDirs.has(parts[1])) return null;

      // /graphics/<name>/ and /graphics/<name> both map to index.html
      const rest = parts.length === 2 ? ['index.html'] : parts.slice(2);
      const localPath = path.resolve(graphicsRoot, parts[1], ...rest);
      const allowedBase = path.resolve(graphicsRoot, parts[1]) + path.sep;
      if (!localPath.startsWith(allowedBase)) return null;
      if (!Object.prototype.hasOwnProperty.call(mimeTypes, path.extname(localPath).toLowerCase())) return null;
      return localPath;
    };

    this.httpServer = http.createServer((req, res) => {
      if (!this._isAllowedGraphicsClient(req.socket.remoteAddress)) {
        sendText(res, 404, '404 Not Found');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, '405 Method Not Allowed', { Allow: 'GET, HEAD' });
        return;
      }

      const parsedUrl = new URL(req.url, 'http://localhost');
      const reqPath = parsedUrl.pathname;

      if (reqPath === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>BOS Graphics Engine</title><style>body{font-family:sans-serif;background:#0f172a;color:#fff;padding:40px;line-height:1.6}a{color:#38bdf8;text-decoration:none;font-weight:bold;font-size:18px}li{margin:12px 0}</style></head>
          <body>
            <h1>BOS Broadcast Graphics Server</h1>
            <p>Active Browser Sources for OBS Studio:</p>
            <ul>
              <li><a href="/graphics/score/" target="_blank">Score Bug (/graphics/score/)</a></li>
              <li><a href="/graphics/goal/" target="_blank">Goal Celebration (/graphics/goal/)</a></li>
              <li><a href="/graphics/lower-third/" target="_blank">Lower Third & F1 Review (/graphics/lower-third/)</a></li>
              <li><a href="/graphics/top-message/" target="_blank">Top Message (/graphics/top-message/)</a></li>
              <li><a href="/graphics/replay/" target="_blank">Replay Overlay (/graphics/replay/)</a></li>
              <li><a href="/graphics/volleyball/" target="_blank">Volleyball Scoreboard (/graphics/volleyball/)</a></li>
              <li><a href="/graphics/basketball/" target="_blank">Basketball Scoreboard (/graphics/basketball/)</a></li>
            </ul>
          </body>
          </html>
        `);
        return;
      }

      const localPath = resolveAllowedFile(reqPath);
      if (!localPath || !fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
        sendText(res, 404, '404 Not Found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(localPath).toLowerCase()],
        'X-Content-Type-Options': 'nosniff'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(localPath).pipe(res);
    });

    this.httpServer.on('error', (err) => {
      // e.g. EADDRINUSE when another BOS instance already owns the port. Do not crash the app.
      this.listenError = err.message;
      console.error(`[GraphicsEngine] Server error on port ${this.port}: ${err.message}`);
    });

    this.wss = new WebSocket.Server({
      server: this.httpServer,
      verifyClient: ({ req }) => this._isAllowedGraphicsClient(req.socket.remoteAddress)
    });
    this.wss.on('error', (err) => {
      // ws forwards the HTTP server's bind error; its EventEmitter also requires a listener.
      if (this.listenError === err.message) return;
      this.listenError = err.message;
      console.error(`[GraphicsEngine] WebSocket server error: ${err.message}`);
    });

    this.wss.on('connection', (ws) => {
      this.connectedClients.add(ws);
      console.log(`[GraphicsEngine] Client connected. Total clients: ${this.connectedClients.size}`);

      // Send initial full sync
      const initPayload = {
        type: 'INITIAL_SYNC',
        score: this.scoreGraphics.getPayload(),
        lowerThird: this.lowerThird.getState(),
        topMessage: {
          active: this.topMessageActive,
          data: this.topMessageData
        },
        replayOverlay: {
          active: this.replayOverlayActive,
          data: this.replayOverlayData
        },
        scorebugVisible: this.scorebugVisible,
        volleyball: this.volleyballGraphics ? this.volleyballGraphics.getSnapshot() : null,
        basketball: this.basketballGraphics ? this.basketballGraphics.getSnapshot() : null
      };
      ws.send(JSON.stringify(initPayload));

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed.type === 'TRANSITION_COVERED') {
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

    // Localhost-only by default; LAN clients must be explicitly allowlisted by IP.
    this.httpServer.listen(this.port, host, () => {
      console.log(`[GraphicsEngine] Server listening at http://${host}:${this.httpServer.address().port}`);
    });
  }

  _normalizeAddress(address) {
    if (typeof address !== 'string') return null;
    let normalized = address.trim().toLowerCase().replace(/%[^%]+$/, '');
    if (normalized.startsWith('::ffff:')) normalized = normalized.slice(7);
    return net.isIP(normalized) ? normalized : null;
  }

  _isAllowedGraphicsClient(address) {
    const normalized = this._normalizeAddress(address);
    if (!normalized) return false;
    if (normalized === '::1' || normalized.startsWith('127.')) return true;
    return !!this.allowedGraphicsClients && this.allowedGraphicsClients.has(normalized);
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
      title: data.title || 'BROADCAST MESSAGE',
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
