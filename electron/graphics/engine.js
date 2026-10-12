const http = require('http');
const fs = require('fs');
const path = require('path');
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

    this.httpServer = null;
    this.wss = null;
    this.port = this.config.get('graphics.httpPort') ?? 8088;
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
        scorebugVisible: this.scorebugVisible
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
