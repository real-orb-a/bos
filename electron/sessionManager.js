const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const SESSION_MODES = new Set([
  'football',
  'basketball',
  'cricket',
  'netball',
  'volleyball',
  'table-tennis',
  'badminton',
  'athletics',
  'formal-event'
]);

const SESSION_STATES = new Set(['SETUP', 'READY', 'LIVE', 'PAUSED', 'ENDED']);
const ATHLETICS_CATEGORY_ALIASES = { track: 'running', field: 'shot-put' };
const normalizeAthleticsCategory = category => ATHLETICS_CATEGORY_ALIASES[category] || category;

class SessionManager extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.activeSession = null;
    this.snapshotTimer = null;
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return;
    const contents = fs.readFileSync(this.filePath, 'utf8');
    const saved = JSON.parse(contents);
    if (saved !== null && (typeof saved !== 'object' || Array.isArray(saved))) {
      throw new Error('Saved session data has an invalid format.');
    }
    if (saved && saved.activeSession && typeof saved.activeSession === 'object') {
      const session = saved.activeSession;
      if (!SESSION_MODES.has(session.modeId) || !SESSION_STATES.has(session.status) ||
          !session.competition || typeof session.competition.name !== 'string') {
        throw new Error('Saved session data is incomplete or invalid.');
      }
      if (session.teams && typeof session.teams.home === 'string') {
        session.teams = {
          home: { id: crypto.randomUUID(), name: session.teams.home, shortName: '', logo: '', primaryColor: '#e11d48', secondaryColor: '#7f1d1d' },
          away: { id: crypto.randomUUID(), name: session.teams.away, shortName: '', logo: '', primaryColor: '#eab308', secondaryColor: '#713f12' }
        };
      }
      session.participants = Array.isArray(session.participants) ? session.participants : [];
      session.sportState = session.sportState && typeof session.sportState === 'object'
        ? { ...this._initialSportState(session.modeId), ...session.sportState }
        : this._initialSportState(session.modeId);
      if (session.modeId === 'table-tennis') {
        const tableTennis = session.sportState.tableTennis;
        const validPlayers = value => value && typeof value === 'object' &&
          ['singles', 'doubles'].includes(value.format) &&
          ['home', 'away'].every(side => {
            const names = value.players?.[side];
            const expectedCount = value.format === 'doubles' ? 2 : 1;
            return Array.isArray(names) && names.length === expectedCount &&
              names.every(name => typeof name === 'string' && name.trim().length > 0 && name.length <= 32);
          });
        session.sportState.tableTennis = validPlayers(tableTennis)
          ? tableTennis
          : {
            format: 'singles',
            players: {
              home: [session.teams?.home?.name || 'Home'],
              away: [session.teams?.away?.name || 'Away']
            }
          };
      }
      session.athletics = session.modeId === 'athletics'
        ? {
          houses: Array.isArray(session.athletics?.houses) ? session.athletics.houses : [
            { id: crypto.randomUUID(), name: 'Garnet', logo: '', color: '#e11d48' },
            { id: crypto.randomUUID(), name: 'Emerald', logo: '', color: '#10b981' },
            { id: crypto.randomUUID(), name: 'Topaz', logo: '', color: '#eab308' }
          ],
          currentEvent: (() => {
            if (session.athletics?.currentEvent) {
              return {
                ...session.athletics.currentEvent,
                category: normalizeAthleticsCategory(session.athletics.currentEvent.category),
                results: Array.isArray(session.athletics.currentEvent.results)
                  ? session.athletics.currentEvent.results : []
              };
            }
            const legacyEvents = Array.isArray(session.athletics?.schedule) ? session.athletics.schedule : [];
            const legacyEvent = legacyEvents.find(event => event.id === session.athletics?.activeEventId) ||
              legacyEvents[0];
            return legacyEvent
              ? {
                ...legacyEvent,
                category: normalizeAthleticsCategory(legacyEvent.category),
                results: Array.isArray(legacyEvent.results) ? legacyEvent.results : []
              }
              : null;
          })(),
          results: Array.isArray(session.athletics?.results) ? session.athletics.results : [],
          podiumVisible: session.athletics?.podiumVisible === true
        }
        : null;
      this.activeSession = saved.activeSession;
    }
  }

  _persist() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ activeSession: this.activeSession }, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }

  _copySession() {
    return this.activeSession ? JSON.parse(JSON.stringify(this.activeSession)) : null;
  }

  getState() {
    const activeSession = this._copySession();
    return {
      activeSession,
      recoverable: !!activeSession && SESSION_STATES.has(activeSession.status) && activeSession.status !== 'ENDED'
    };
  }

  create(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Session details are required.');
    }
    if (!SESSION_MODES.has(data.mode)) {
      throw new Error('Select a supported broadcast mode.');
    }

    const text = (value, label, maxLength = 120, required = false) => {
      if (typeof value !== 'string') {
        if (required) throw new Error(`${label} is required.`);
        return '';
      }
      const result = value.trim();
      if (required && !result) throw new Error(`${label} is required.`);
      if (result.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
      return result;
    };

    const mode = data.mode;
    const housePalette = {
      garnet: { primaryColor: '#e11d48', secondaryColor: '#7f1d1d' },
      emerald: { primaryColor: '#10b981', secondaryColor: '#064e3b' },
      topaz: { primaryColor: '#eab308', secondaryColor: '#713f12' }
    };
    const teamColors = (name, fallback) =>
      housePalette[name.toLocaleLowerCase()] || fallback;
    const competition = {
      id: crypto.randomUUID(),
      name: text(data.competitionName, 'Competition name', 60, true),
      shortName: text(data.shortName, 'Competition short name', 40),
      season: text(data.season, 'Season', 24),
      division: text(data.division, 'Division', 60),
      venue: text(data.venue, 'Venue', 100),
      date: text(data.date, 'Date', 32)
    };
    let tableTennis = null;
    if (mode === 'table-tennis') {
      const format = data.tableTennisFormat;
      if (!['singles', 'doubles'].includes(format)) {
        throw new Error('Choose table tennis singles (1v1) or doubles (2v2).');
      }
      const playerCount = format === 'doubles' ? 2 : 1;
      if (!data.tableTennisPlayers || typeof data.tableTennisPlayers !== 'object') {
        throw new Error('Enter the table tennis player names.');
      }
      const players = {};
      for (const side of ['home', 'away']) {
        const names = data.tableTennisPlayers[side];
        if (!Array.isArray(names) || names.length !== playerCount) {
          throw new Error(`Enter ${playerCount} ${format === 'singles' ? 'player' : 'players'} for the ${side} side.`);
        }
        players[side] = names.map((name, index) =>
          text(name, `${side === 'home' ? 'Home' : 'Away'} player ${index + 1}`, 32, true));
      }
      tableTennis = { format, players };
    }
    if (competition.date) {
      const parsedDate = Date.parse(`${competition.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(competition.date) ||
          Number.isNaN(parsedDate) ||
          new Date(parsedDate).toISOString().slice(0, 10) !== competition.date) {
        throw new Error('Date must be a valid calendar date.');
      }
    }
    const homeTeamName = mode === 'formal-event' || mode === 'athletics'
      ? '' : text(data.homeTeam, 'Home team', 60, true);
    const awayTeamName = mode === 'formal-event' || mode === 'athletics'
      ? '' : text(data.awayTeam, 'Away team', 60, true);
    const teams = mode === 'formal-event' || mode === 'athletics' ? null : {
      home: {
        id: crypto.randomUUID(),
        name: text(data.homeTeamBrand?.name || homeTeamName, 'Home team', 60, true),
        shortName: text(data.homeTeamBrand?.shortName, 'Home team short name', 12),
        logo: typeof data.homeTeamBrand?.logo === 'string' ? data.homeTeamBrand.logo : '',
        ...teamColors(homeTeamName, {
          primaryColor: '#e11d48',
          secondaryColor: '#7f1d1d'
        }),
        ...(data.homeTeamBrand?.primaryColor ? {
          primaryColor: data.homeTeamBrand.primaryColor,
          secondaryColor: data.homeTeamBrand.secondaryColor
        } : {})
      },
      away: {
        id: crypto.randomUUID(),
        name: text(data.awayTeamBrand?.name || awayTeamName, 'Away team', 60, true),
        shortName: text(data.awayTeamBrand?.shortName, 'Away team short name', 12),
        logo: typeof data.awayTeamBrand?.logo === 'string' ? data.awayTeamBrand.logo : '',
        ...teamColors(awayTeamName, {
          primaryColor: '#eab308',
          secondaryColor: '#713f12'
        }),
        ...(data.awayTeamBrand?.primaryColor ? {
          primaryColor: data.awayTeamBrand.primaryColor,
          secondaryColor: data.awayTeamBrand.secondaryColor
        } : {})
      }
    };

    this.activeSession = {
      id: crypto.randomUUID(),
      mode: mode === 'formal-event' ? 'event' : 'sport',
      sportId: mode === 'formal-event' ? null : mode,
      modeId: mode,
      status: 'SETUP',
      competition,
      teams,
      participantIds: [],
      sportState: {
        ...this._initialSportState(mode),
        ...(tableTennis ? { tableTennis } : {})
      },
      participants: [],
      athletics: mode === 'athletics' ? {
        houses: Array.isArray(data.athleticsHouses) && data.athleticsHouses.length
          ? data.athleticsHouses.map(house => ({
            id: crypto.randomUUID(),
            name: text(house.name, 'House name', 60, true),
            logo: typeof house.logo === 'string' ? house.logo : '',
            color: /^#[0-9a-f]{6}$/i.test(house.primaryColor || '') ? house.primaryColor : '#64748b'
          }))
          : [
          { id: crypto.randomUUID(), name: 'Garnet', logo: '', color: '#e11d48' },
          { id: crypto.randomUUID(), name: 'Emerald', logo: '', color: '#10b981' },
          { id: crypto.randomUUID(), name: 'Topaz', logo: '', color: '#eab308' }
        ],
        currentEvent: null,
        results: [],
        podiumVisible: false
      } : null,
      graphicsState: {},
      replayState: {},
      snapshot: null,
      startedAt: null,
      endedAt: null,
      createdAt: new Date().toISOString()
    };
    this._persist();
    return this._copySession();
  }

  applyScoreChange(side, amount, scoreManager, eventLogger) {
    const session = this._requireActiveSession();
    if (!['home', 'away'].includes(side) || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 100) {
      throw new Error('Score change must be a non-zero whole number from -100 to 100.');
    }
    const mode = session.modeId;
    const gameModes = ['volleyball', 'table-tennis', 'badminton'];
    if (gameModes.includes(mode) && session.sportState.matchComplete) {
      throw new Error('The match is complete. Start a new session to record another result.');
    }
    if (mode === 'basketball' && ![1, 2, 3, -1, -2, -3].includes(amount)) {
      throw new Error('Basketball score changes must be 1, 2, or 3 points.');
    }

    let completed = null;
    if (amount > 0) {
      scoreManager[side === 'home' ? 'addHome' : 'addAway'](amount);
    } else {
      scoreManager[side === 'home' ? 'subtractHome' : 'subtractAway'](-amount);
    }
    const scoreAfter = scoreManager.getScore();

    if (gameModes.includes(mode) && amount > 0) {
      const completedSetCount = session.sportState.sets.home + session.sportState.sets.away;
      const target = mode === 'volleyball'
        ? (completedSetCount >= (session.sportState.bestOf || 5) - 1
          ? (session.sportState.decidingSetPointsToWin || 15)
          : (session.sportState.pointsToWin || 25))
        : (session.sportState.pointsToWin || (mode === 'table-tennis' ? 11 : 21));
      const requiredLead = mode === 'volleyball' ? (session.sportState.pointsToWinBy || 2) : 2;
      const winner = ['home', 'away'].find(team =>
        scoreAfter[team].score >= target && scoreAfter[team].score - scoreAfter[team === 'home' ? 'away' : 'home'].score >= requiredLead
      );
      if (winner) {
        const completedGames = session.sportState.completedGames || [];
        completed = {
          number: completedGames.length + 1,
          winner,
          points: { home: scoreAfter.home.score, away: scoreAfter.away.score },
          completedAt: new Date().toISOString()
        };
        completedGames.push(completed);
        session.sportState.completedGames = completedGames;
        session.sportState.sets[winner]++;
        session.sportState.periodNumber = completedGames.length + 1;
        session.sportState.period = mode === 'volleyball'
          ? `Set ${session.sportState.periodNumber}`
          : `Game ${session.sportState.periodNumber}`;
        const setsToWin = Math.floor((session.sportState.bestOf || (mode === 'badminton' ? 3 : 5)) / 2) + 1;
        session.sportState.matchComplete = session.sportState.sets[winner] >= setsToWin;
        scoreManager.resetScore();
        if (eventLogger) {
          eventLogger.recordEvent('GAME_COMPLETED', {
            game: completed.number,
            winner: scoreAfter[winner].name,
            points: completed.points
          });
        }
      }
    }
    this._persist();
    return { session: this._copySession(), score: scoreManager.getScore(), completed };
  }

  _initialSportState(mode) {
    return {
      period: mode === 'cricket' ? '1st Innings'
        : mode === 'basketball' ? '1st Quarter' : '1st Period',
      periodNumber: 1,
      wickets: { home: 0, away: 0 },
      overs: { home: 0, away: 0 },
      sets: { home: 0, away: 0 },
      completedGames: [],
      bestOf: mode === 'volleyball' || mode === 'table-tennis' ? 5 : mode === 'badminton' ? 3 : null,
      tableTennis: mode === 'table-tennis' ? {
        format: 'singles',
        players: { home: [], away: [] }
      } : null,
      pointsToWin: mode === 'table-tennis' ? 11 : mode === 'badminton' ? 21 : mode === 'volleyball' ? 25 : null,
      decidingSetPointsToWin: mode === 'volleyball' ? 15 : null,
      pointsToWinBy: mode === 'volleyball' ? 2 : null,
      shotClockSeconds: mode === 'basketball' ? 24 : null,
      fouls: { home: 0, away: 0 },
      timeouts: { home: 0, away: 0 },
      matchComplete: false
    };
  }

  _requireActiveSession() {
    if (!this.activeSession || this.activeSession.status === 'ENDED') {
      throw new Error('There is no active session.');
    }
    return this.activeSession;
  }

  getActiveSession() {
    return this._copySession();
  }

  updateCompetitionName(name) {
    const session = this._requireActiveSession();
    if (typeof name !== 'string' || !name.trim() || Array.from(name.trim()).length > 60) {
      throw new Error('Match or event name must contain 1 to 60 characters.');
    }
    session.competition.name = name.trim();
    this._persist();
    return this._copySession();
  }

  addParticipant(input) {
    const session = this._requireActiveSession();
    if (!input || typeof input !== 'object') throw new Error('Participant details are required.');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 80) throw new Error('Participant name must contain 1 to 80 characters.');
    const allowedTypes = ['athlete', 'player', 'official', 'speaker', 'house', 'team', 'other'];
    if (!allowedTypes.includes(input.type)) throw new Error('Select a supported participant type.');
    const number = input.number === '' || input.number === undefined ? null : Number(input.number);
    if (number !== null && (!Number.isInteger(number) || number < 0 || number > 9999)) {
      throw new Error('Participant number must be a whole number from 0 to 9999.');
    }
    const participant = {
      id: crypto.randomUUID(),
      name,
      type: input.type,
      number,
      team: typeof input.team === 'string' ? input.team.trim().slice(0, 60) : '',
      role: typeof input.role === 'string' ? input.role.trim().slice(0, 80) : '',
      createdAt: new Date().toISOString()
    };
    session.participants.push(participant);
    this._persist();
    return this._copySession();
  }

  removeParticipant(id) {
    const session = this._requireActiveSession();
    const before = session.participants.length;
    session.participants = session.participants.filter(item => item.id !== id);
    if (session.participants.length === before) throw new Error('Participant was not found.');
    this._persist();
    return this._copySession();
  }

  setTeamLogo(side, dataUrl) {
    const session = this._requireActiveSession();
    if (!['home', 'away'].includes(side) || !session.teams) {
      throw new Error('This session does not have that team.');
    }
    if (typeof dataUrl !== 'string' || dataUrl.length > 1_000_000 ||
        !/^data:image\/(?:svg\+xml|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) {
      throw new Error('Team logo must be a base64 SVG, PNG, or JPEG image under 750 KB.');
    }
    session.teams[side].logo = dataUrl;
    this._persist();
    return this._copySession();
  }

  addAthleticsHouse(input) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('Houses can only be managed in an Athletics session.');
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 60) throw new Error('House name must contain 1 to 60 characters.');
    if (session.athletics.houses.length >= 16) throw new Error('An Athletics session can have at most 16 houses.');
    if (session.athletics.houses.some(house => house.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('That house already exists.');
    }
    session.athletics.houses.push({
      id: crypto.randomUUID(),
      name,
      logo: '',
      color: '#64748b'
    });
    this._persist();
    return this._copySession();
  }

  setAthleticsHouseLogo(houseId, dataUrl) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('House logos can only be managed in an Athletics session.');
    const house = session.athletics.houses.find(item => item.id === houseId);
    if (!house) throw new Error('Select a house before setting its logo.');
    if (typeof dataUrl !== 'string' || dataUrl.length > 1_000_000 ||
        !/^data:image\/(?:svg\+xml|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) {
      throw new Error('House logo must be a base64 SVG, PNG, or JPEG image under 750 KB.');
    }
    house.logo = dataUrl;
    this._persist();
    return this._copySession();
  }

  updateSportState(patch) {
    const session = this._requireActiveSession();
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Sport state changes must be an object.');
    }
    const definitions = {
      period: value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80
        ? value.trim() : null,
      periodNumber: value => Number.isInteger(value) && value >= 1 && value <= 99 ? value : null,
      pointsToWin: value => Number.isInteger(value) && value >= 1 && value <= 999 ? value : null,
      decidingSetPointsToWin: value => Number.isInteger(value) && value >= 1 && value <= 999 ? value : null,
      pointsToWinBy: value => Number.isInteger(value) && value >= 1 && value <= 10 ? value : null,
      shotClockSeconds: value => Number.isInteger(value) && value >= 1 && value <= 120 ? value : null,
      bestOf: value => Number.isInteger(value) && value >= 1 && value <= 9 && value % 2 === 1 ? value : null
    };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'wickets' || key === 'overs' || key === 'sets' || key === 'fouls' || key === 'timeouts') {
        if (!value || typeof value !== 'object') throw new Error(`${key} must provide home and away values.`);
        for (const side of ['home', 'away']) {
          const next = value[side];
          if (next !== undefined && (!Number.isInteger(next) || next < 0 || next > 9999)) {
            throw new Error(`${key} values must be whole numbers from 0 to 9999.`);
          }
          if (next !== undefined) session.sportState[key][side] = next;
        }
        continue;
      }
      if (!definitions[key]) throw new Error(`Sport state field "${key}" is not supported.`);
      const normalized = definitions[key](value);
      if (normalized === null) throw new Error(`Invalid value for ${key}.`);
      session.sportState[key] = normalized;
    }
    this._persist();
    return this._copySession();
  }

  setAthleticsEvent(input) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('The live Athletics event can only be changed in an Athletics session.');
    if (!input || typeof input !== 'object') throw new Error('Event details are required.');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) throw new Error('Event name must contain 1 to 100 characters.');
    const category = normalizeAthleticsCategory(input.category);
    if (!['running', 'shot-put', 'relay'].includes(category)) {
      throw new Error('Event category must be Running, Shot Put, or Baton Relay.');
    }
    if (session.athletics.currentEvent) {
      session.athletics.currentEvent.name = name;
      session.athletics.currentEvent.category = category;
    } else {
      session.athletics.currentEvent = { id: crypto.randomUUID(), name, category, results: [] };
    }
    this._persist();
    return this._copySession();
  }

  setAthleticsPodiumVisible(visible) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('The podium is only available in an Athletics session.');
    if (typeof visible !== 'boolean') throw new Error('Podium visibility must be a boolean.');
    session.athletics.podiumVisible = visible;
    this._persist();
    return this._copySession();
  }

  getAthleticsBroadcastState() {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') return { active: false, event: null, houses: [] };
    const event = session.athletics.currentEvent || null;
    return {
      active: true,
      competition: session.competition.name,
      podiumVisible: session.athletics.podiumVisible === true,
      event: event ? {
        id: event.id,
        name: event.name,
        category: event.category,
        results: event.results.map(result => ({
          place: result.place,
          athleteName: result.athleteName,
          runnerNames: result.runnerNames || [],
          team: result.team,
          result: result.result,
          points: result.points,
          attempts: result.attempts || []
        }))
      } : null,
      houses: session.athletics.houses.map(house => ({
        name: house.name,
        logo: house.logo,
        color: house.color
      }))
    };
  }

  recordAthleticsResult(input) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('Results can only be recorded in an Athletics session.');
    const event = session.athletics.currentEvent;
    if (!event) throw new Error('Set the live Athletics event title and category first.');
    const participant = typeof input.participantId === 'string'
      ? session.participants.find(item => item.id === input.participantId)
      : null;
    const athleteName = participant?.name || (typeof input.athleteName === 'string' ? input.athleteName.trim() : '');
    const team = typeof input.team === 'string' ? input.team.trim() : '';
    if (event.category === 'shot-put') {
      return this._recordShotPutAttempt(session, event, athleteName, team, input);
    }
    const result = typeof input.result === 'string' ? input.result.trim() : '';
    const place = Number(input.place);
    const points = input.points === undefined ? ({ 1: 5, 2: 3, 3: 1 }[Number(input.place)] || 0) : Number(input.points);
    const runnerNames = Array.isArray(input.runnerNames)
      ? input.runnerNames.map(name => typeof name === 'string' ? name.trim() : '').filter(Boolean)
      : [];
    if (event.category === 'relay') {
      if (runnerNames.length < 2 || runnerNames.length > 8 || runnerNames.some(name => name.length > 80)) {
        throw new Error('Enter 2 to 8 relay runners in running order.');
      }
    } else if (!athleteName || athleteName.length > 80) {
      throw new Error('Athlete name is required.');
    }
    if (!team || team.length > 60) throw new Error('House/team is required.');
    if (!session.athletics.houses.some(house => house.name === team)) {
      throw new Error('Select a house configured for this Athletics session.');
    }
    if (!result || result.length > 80) throw new Error('Enter a result, time, or distance.');
    if (!Number.isInteger(place) || place < 1 || place > 999) throw new Error('Place must be a whole number from 1 to 999.');
    if (!Number.isFinite(points) || points < 0 || points > 10000) throw new Error('Points must be from 0 to 10000.');
    const entry = {
      id: crypto.randomUUID(),
      athleteName,
      runnerNames: event.category === 'relay' ? runnerNames : [],
      participantId: participant?.id || null,
      team,
      result,
      place,
      points,
      recordedAt: new Date().toISOString()
    };
    event.results.push(entry);
    event.results.sort((a, b) => a.place - b.place || a.recordedAt.localeCompare(b.recordedAt));
    session.athletics.results.push({ eventId: event.id, eventName: event.name, ...entry });
    this._persist();
    return this._copySession();
  }

  _recordShotPutAttempt(session, event, athleteName, team, input) {
    const attempt = Number(input.attempt);
    const distance = Number(input.distance);
    if (!athleteName || athleteName.length > 80) throw new Error('Athlete name is required.');
    if (!team || team.length > 60) throw new Error('House/team is required.');
    if (!session.athletics.houses.some(house => house.name === team)) {
      throw new Error('Select a house configured for this Athletics session.');
    }
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > 6) {
      throw new Error('Shot Put turn must be a whole number from 1 to 6.');
    }
    if (!Number.isFinite(distance) || distance <= 0 || distance > 100) {
      throw new Error('Distance must be greater than 0 and no more than 100 metres.');
    }

    let entry = event.results.find(result =>
      (result.athleteName || '').toLocaleLowerCase() === athleteName.toLocaleLowerCase() &&
      result.team === team
    );
    if (!entry) {
      entry = {
        id: crypto.randomUUID(),
        athleteName,
        runnerNames: [],
        participantId: null,
        team,
        result: '',
        place: event.results.length + 1,
        points: 0,
        attempts: [],
        recordedAt: new Date().toISOString()
      };
      event.results.push(entry);
    }
    entry.attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
    entry.attempts[attempt - 1] = Number(distance.toFixed(2));
    entry.bestDistance = Math.max(...entry.attempts.filter(Number.isFinite));
    entry.result = `${entry.bestDistance.toFixed(2)} m`;

    this._rankShotPutResults(session, event);
    this._persist();
    return this._copySession();
  }

  _rankShotPutResults(session, event) {
    event.results.sort((a, b) => {
      const aDistance = Number.isFinite(a.bestDistance) ? a.bestDistance : -Infinity;
      const bDistance = Number.isFinite(b.bestDistance) ? b.bestDistance : -Infinity;
      return bDistance - aDistance || (a.recordedAt || '').localeCompare(b.recordedAt || '');
    });
    event.results.forEach((result, index) => {
      result.place = index + 1;
      result.points = ({ 1: 5, 2: 3, 3: 1 }[result.place] || 0);
    });
    session.athletics.results = session.athletics.results.filter(result =>
      result.eventId !== event.id || !event.results.some(current => current.id === result.id)
    );
    session.athletics.results.push(...event.results.map(result => ({
      eventId: event.id,
      eventName: event.name,
      ...result
    })));
  }

  removeAthleticsResult(resultId) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('Results can only be changed in an Athletics session.');
    const event = session.athletics.currentEvent;
    const index = event?.results.findIndex(result => result.id === resultId) ?? -1;
    if (index < 0) throw new Error('The live Athletics result was not found.');
    event.results.splice(index, 1);
    session.athletics.results = session.athletics.results.filter(result => result.id !== resultId);
    if (event.category === 'shot-put') this._rankShotPutResults(session, event);
    this._persist();
    return this._copySession();
  }

  getAthleticsStandings() {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') return [];
    const totals = new Map();
    for (const result of session.athletics.results) {
      const current = totals.get(result.team) || { team: result.team, points: 0, medals: { gold: 0, silver: 0, bronze: 0 }, results: 0 };
      current.points += result.points;
      current.results++;
      if (result.place === 1) current.medals.gold++;
      if (result.place === 2) current.medals.silver++;
      if (result.place === 3) current.medals.bronze++;
      totals.set(result.team, current);
    }
    return [...totals.values()].sort((a, b) =>
      b.points - a.points || b.medals.gold - a.medals.gold ||
      b.medals.silver - a.medals.silver || b.medals.bronze - a.medals.bronze ||
      a.team.localeCompare(b.team)
    );
  }

  activate() {
    if (!this.activeSession || this.activeSession.status === 'ENDED') {
      throw new Error('There is no session to activate.');
    }
    if (this.activeSession.status === 'SETUP') {
      this.activeSession.status = 'READY';
      this.activeSession.startedAt = new Date().toISOString();
      this._persist();
    }
    return this._copySession();
  }

  updateStatus(status) {
    if (!SESSION_STATES.has(status)) throw new Error('Invalid session status.');
    if (!this.activeSession || this.activeSession.status === 'ENDED') return null;
    if (this.activeSession.status !== status) {
      this.activeSession.status = status;
      this._persist();
    }
    return this._copySession();
  }

  resume() {
    if (!this.getState().recoverable) throw new Error('There is no recoverable session.');
    if (this.activeSession.status === 'SETUP') {
      this.activeSession.status = 'READY';
      this.activeSession.startedAt = this.activeSession.startedAt || new Date().toISOString();
      this._persist();
    }
    return this._copySession();
  }

  end() {
    if (!this.activeSession) return null;
    this.activeSession.status = 'ENDED';
    this.activeSession.endedAt = new Date().toISOString();
    this._persist();
    return this._copySession();
  }

  discard() {
    this.activeSession = null;
    this._persist();
    return this.getState();
  }

  saveSnapshot(score, match) {
    if (!this.activeSession || this.activeSession.status === 'ENDED') return;
    this.activeSession.snapshot = {
      score,
      match,
      savedAt: new Date().toISOString()
    };
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      try {
        this._persist();
      } catch (error) {
        this.emit('storageError', error);
      }
    }, 300);
  }

  flush() {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
      this._persist();
    }
  }
}

module.exports = SessionManager;
