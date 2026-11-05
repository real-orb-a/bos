const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const loadTeamCatalog = require('./teamCatalog');

const SESSION_MODES = new Set([
  'football',
  'basketball',
  'cricket',
  'netball',
  'volleyball',
  'table-tennis',
  'badminton',
  'athletics'
]);

const SESSION_STATES = new Set(['SETUP', 'READY', 'LIVE', 'PAUSED', 'ENDED']);
const ATHLETICS_CATEGORY_ALIASES = { track: 'running', field: 'shot-put' };
const normalizeAthleticsCategory = category => ATHLETICS_CATEGORY_ALIASES[category] || category;
const defaultPlayerShortCode = name => String(name || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 3) || 'PLY';
const defaultAthleteShortCode = name => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1
    ? (parts.map(part => part[0]).join('').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'ATH')
    : ((parts[0] || '').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'ATH');
};

class SessionManager extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.sessionsDirectory = path.join(path.dirname(filePath), 'sessions');
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
      let savedHouses = [];
      try { savedHouses = loadTeamCatalog(); } catch { /* Keep saved identities if the catalog is unavailable. */ }
      if (session.teams && typeof session.teams === 'object') {
        for (const side of ['home', 'away']) {
          const team = session.teams[side];
          const house = savedHouses.find(item => item.id === team?.id) ||
            savedHouses.find(item => item.name.toLocaleLowerCase() === String(team?.name || '').toLocaleLowerCase());
          if (!team || !house) continue;
          session.teams[side] = {
            ...team,
            id: house.id,
            name: house.name,
            shortName: house.shortName || team.shortName || house.name.slice(0, 3).toUpperCase(),
            primaryColor: house.primaryColor,
            secondaryColor: house.secondaryColor,
            logo: house.logo
          };
        }
      }
      session.participants = Array.isArray(session.participants) ? session.participants : [];
      const savedRacketMatch = session.sportState?.racketMatch || session.sportState?.tableTennis;
      session.sportState = session.sportState && typeof session.sportState === 'object'
        ? { ...this._initialSportState(session.modeId), ...session.sportState }
        : this._initialSportState(session.modeId);
      if (['table-tennis', 'badminton'].includes(session.modeId)) {
        const racketMatch = savedRacketMatch || session.sportState.racketMatch;
        const normalizeSavedPlayer = player => {
          const name = typeof player === 'string' ? player.trim()
            : typeof player?.name === 'string' ? player.name.trim() : '';
          const shortCode = typeof player === 'object' && typeof player?.shortCode === 'string'
            ? player.shortCode.trim().toUpperCase() : defaultPlayerShortCode(name);
          return name && name.length <= 32 && /^[A-Z0-9]{1,3}$/.test(shortCode)
            ? { name, shortCode } : null;
        };
        const normalizedPlayers = racketMatch && typeof racketMatch === 'object' &&
          ['singles', 'doubles'].includes(racketMatch.format)
          ? Object.fromEntries(['home', 'away'].map(side => {
            const raw = racketMatch.players?.[side];
            const players = Array.isArray(raw) ? raw.map(normalizeSavedPlayer) : [];
            return [side, players.every(Boolean) ? players : null];
          })) : null;
        const expectedCount = racketMatch?.format === 'doubles' ? 2 : 1;
        const validRacketMatch = normalizedPlayers && ['home', 'away'].every(side =>
          normalizedPlayers[side]?.length === expectedCount);
        session.sportState.racketMatch = validRacketMatch
          ? { format: racketMatch.format, players: normalizedPlayers }
          : {
            format: 'singles',
            players: {
              home: [{
                name: session.teams?.home?.name || 'Home',
                shortCode: defaultPlayerShortCode(session.teams?.home?.name || 'Home')
              }],
              away: [{
                name: session.teams?.away?.name || 'Away',
                shortCode: defaultPlayerShortCode(session.teams?.away?.name || 'Away')
              }]
            }
          };
        if (session.modeId === 'table-tennis') {
          session.sportState.tableTennis = {
            format: session.sportState.racketMatch.format,
            players: Object.fromEntries(['home', 'away'].map(side => [
              side, session.sportState.racketMatch.players[side].map(player => player.name)
            ]))
          };
        }
      }
      const athleticsHouseIdMap = new Map();
      const normalizeAthleticsHouse = savedHouse => {
        const house = savedHouses.find(item => item.id === savedHouse.id) ||
          savedHouses.find(item => item.name.toLocaleLowerCase() === String(savedHouse.name || '').toLocaleLowerCase());
        if (!house) return savedHouse;
        if (savedHouse.id && savedHouse.id !== house.id) athleticsHouseIdMap.set(savedHouse.id, house.id);
        return {
          ...savedHouse,
          id: house.id,
          name: house.name,
          shortName: house.shortName,
          color: house.primaryColor,
          logo: house.logo
        };
      };
      const normalizeAthleteAssignments = athletes => {
        if (!athletes || typeof athletes !== 'object' || Array.isArray(athletes)) return {};
        const remapped = { ...athletes };
        for (const [oldId, newId] of athleticsHouseIdMap) {
          if (!(oldId in remapped)) continue;
          remapped[newId] = [...(Array.isArray(remapped[newId]) ? remapped[newId] : []),
            ...(Array.isArray(remapped[oldId]) ? remapped[oldId] : [])];
          delete remapped[oldId];
        }
        return remapped;
      };
      const normalizeAthleteShortCodes = (codes, athletes) => {
        const remapped = codes && typeof codes === 'object' && !Array.isArray(codes) ? { ...codes } : {};
        for (const [oldId, newId] of athleticsHouseIdMap) {
          if (!(oldId in remapped)) continue;
          remapped[newId] = { ...(remapped[oldId] || {}), ...(remapped[newId] || {}) };
          delete remapped[oldId];
        }
        for (const [houseId, names] of Object.entries(athletes || {})) {
          if (!Array.isArray(names)) continue;
          const houseCodes = { ...(remapped[houseId] || {}) };
          const used = new Set();
          for (const name of names) {
            let code = typeof houseCodes[name] === 'string' ? houseCodes[name].trim().toUpperCase() : '';
            if (!/^[A-Z0-9]{1,4}$/.test(code) || used.has(code)) {
              const base = defaultAthleteShortCode(name);
              code = base;
              const prefix = base.slice(0, 2).padEnd(2, 'X');
              for (let suffix = 1; used.has(code) && suffix < 1296; suffix++) {
                code = `${prefix}${suffix.toString(36).toUpperCase().padStart(2, '0')}`;
              }
            }
            used.add(code);
            houseCodes[name] = code;
          }
          remapped[houseId] = houseCodes;
        }
        return remapped;
      };
      const normalizeSavedAthleticsEvent = event => {
        const athletes = normalizeAthleteAssignments(event.athletes);
        return {
          ...event,
          category: normalizeAthleticsCategory(event.category),
          resultRequired: event.resultRequired !== false,
          liveStandings: event.liveStandings !== false,
          athletes,
          athleteShortCodes: normalizeAthleteShortCodes(event.athleteShortCodes, athletes)
        };
      };
      session.athletics = session.modeId === 'athletics'
        ? {
          houses: (Array.isArray(session.athletics?.houses) ? session.athletics.houses : [
            { id: crypto.randomUUID(), name: 'Garnet', logo: '', color: '#e11d48' },
            { id: crypto.randomUUID(), name: 'Emerald', logo: '', color: '#10b981' },
            { id: crypto.randomUUID(), name: 'Topaz', logo: '', color: '#eab308' }
          ]).map(normalizeAthleticsHouse),
          events: Array.isArray(session.athletics?.events)
            ? session.athletics.events.map(normalizeSavedAthleticsEvent)
            : Array.isArray(session.athletics?.schedule) ? session.athletics.schedule.map(normalizeSavedAthleticsEvent) : [],
          currentEvent: (() => {
            if (session.athletics?.currentEvent) {
              const currentEvent = session.athletics.currentEvent;
              const athletes = normalizeAthleteAssignments(currentEvent.athletes);
              return {
                ...currentEvent,
                category: normalizeAthleticsCategory(currentEvent.category),
                resultRequired: currentEvent.resultRequired !== false,
                liveStandings: currentEvent.liveStandings !== false,
                athletes,
                athleteShortCodes: normalizeAthleteShortCodes(currentEvent.athleteShortCodes, athletes),
                results: Array.isArray(currentEvent.results) ? currentEvent.results : []
              };
            }
            const legacyEvents = Array.isArray(session.athletics?.schedule) ? session.athletics.schedule : [];
            const legacyEvent = legacyEvents.find(event => event.id === session.athletics?.activeEventId) ||
              legacyEvents[0];
            return legacyEvent
              ? { ...normalizeSavedAthleticsEvent(legacyEvent), results: Array.isArray(legacyEvent.results) ? legacyEvent.results : [] }
              : null;
          })(),
          results: Array.isArray(session.athletics?.results) ? session.athletics.results : [],
          displayMode: session.athletics?.displayMode === 'after' ? 'after' : 'live'
        }
        : null;
      this.activeSession = saved.activeSession;
      this._persist();
    }
  }

  _persist() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    if (this.activeSession) {
      fs.mkdirSync(this.sessionsDirectory, { recursive: true });
      const safeId = String(this.activeSession.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeId) throw new Error('Cannot save a session without a valid ID.');
      const sessionPath = path.join(this.sessionsDirectory, `${safeId}.json`);
      const sessionTemporaryPath = `${sessionPath}.tmp`;
      fs.writeFileSync(sessionTemporaryPath, JSON.stringify(this.activeSession, null, 2), 'utf8');
      fs.renameSync(sessionTemporaryPath, sessionPath);
    }
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
    const competition = {
      id: crypto.randomUUID(),
      name: text(data.competitionName, 'Competition name', 60, true),
      shortName: text(data.shortName, 'Competition short name', 40),
      season: text(data.season, 'Season', 24),
      division: text(data.division, 'Division', 60),
      venue: text(data.venue, 'Venue', 100),
      date: text(data.date, 'Date', 32)
    };
    let racketMatch = null;
    if (['table-tennis', 'badminton'].includes(mode)) {
      const format = data.racketFormat || data.tableTennisFormat;
      if (!['singles', 'doubles'].includes(format)) {
        throw new Error(`Choose ${mode === 'badminton' ? 'badminton' : 'table tennis'} singles or doubles.`);
      }
      const playerCount = format === 'doubles' ? 2 : 1;
      const submittedPlayers = data.racketPlayers || data.tableTennisPlayers;
      if (!submittedPlayers || typeof submittedPlayers !== 'object') {
        throw new Error(`Enter the ${mode === 'badminton' ? 'badminton' : 'table tennis'} player names.`);
      }
      const players = {};
      for (const side of ['home', 'away']) {
        const names = submittedPlayers[side];
        if (!Array.isArray(names) || names.length !== playerCount) {
          throw new Error(`Enter ${playerCount} ${format === 'singles' ? 'player' : 'players'} for the ${side} side.`);
        }
        players[side] = names.map((player, index) => {
          const label = `${side === 'home' ? 'Home' : 'Away'} player ${index + 1}`;
          const name = text(typeof player === 'string' ? player : player?.name, label, 32, true);
          const shortCode = text(typeof player === 'string' ? defaultPlayerShortCode(name) : player?.shortCode,
            `${label} shortcode`, 3, true).toUpperCase();
          if (!/^[A-Z0-9]{1,3}$/.test(shortCode)) {
            throw new Error(`${label} shortcode must be 1 to 3 letters or numbers.`);
          }
          return { name, shortCode };
        });
      }
      racketMatch = { format, players };
    }
    if (competition.date) {
      const parsedDate = Date.parse(`${competition.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(competition.date) ||
          Number.isNaN(parsedDate) ||
          new Date(parsedDate).toISOString().slice(0, 10) !== competition.date) {
        throw new Error('Date must be a valid calendar date.');
      }
    }
    const homeTeamInput = data.homeTeam || {};
    const awayTeamInput = data.awayTeam || {};
    const homeTeamName = mode === 'athletics'
      ? '' : text(homeTeamInput.name, 'Home team', 60, true);
    const awayTeamName = mode === 'athletics'
      ? '' : text(awayTeamInput.name, 'Away team', 60, true);
    const teams = mode === 'athletics' ? null : {
      home: {
        id: typeof homeTeamInput.id === 'string' && homeTeamInput.id ? homeTeamInput.id : crypto.randomUUID(),
        name: homeTeamName || 'HOME',
        shortName: typeof homeTeamInput.shortName === 'string' && homeTeamInput.shortName.trim()
          ? homeTeamInput.shortName.trim().slice(0, 12) : homeTeamName?.slice(0, 3).toUpperCase() || 'HOM',
        logo: typeof homeTeamInput.logo === 'string' ? homeTeamInput.logo : '',
        primaryColor: /^#[0-9a-f]{6}$/i.test(homeTeamInput.primaryColor || homeTeamInput.color || '')
          ? (homeTeamInput.primaryColor || homeTeamInput.color) : '#e11d48',
        secondaryColor: /^#[0-9a-f]{6}$/i.test(homeTeamInput.secondaryColor || '') ? homeTeamInput.secondaryColor : '#7f1d1d'
      },
      away: {
        id: typeof awayTeamInput.id === 'string' && awayTeamInput.id ? awayTeamInput.id : crypto.randomUUID(),
        name: awayTeamName || 'AWAY',
        shortName: typeof awayTeamInput.shortName === 'string' && awayTeamInput.shortName.trim()
          ? awayTeamInput.shortName.trim().slice(0, 12) : awayTeamName?.slice(0, 3).toUpperCase() || 'AWY',
        logo: typeof awayTeamInput.logo === 'string' ? awayTeamInput.logo : '',
        primaryColor: /^#[0-9a-f]{6}$/i.test(awayTeamInput.primaryColor || awayTeamInput.color || '')
          ? (awayTeamInput.primaryColor || awayTeamInput.color) : '#eab308',
        secondaryColor: /^#[0-9a-f]{6}$/i.test(awayTeamInput.secondaryColor || '') ? awayTeamInput.secondaryColor : '#713f12'
      }
    };

    const athleticsHouses = mode === 'athletics'
      ? (Array.isArray(data.athleticsHouses) ? data.athleticsHouses.map(house => ({
        id: house.id,
        name: text(house.name, 'House name', 60, true),
        logo: typeof house.logo === 'string' ? house.logo : '',
        color: /^#[0-9a-f]{6}$/i.test(house.primaryColor || '') ? house.primaryColor : '#64748b',
        shortName: house.shortName || '',
        runners: []
      })) : [])
      : null;
    if (mode === 'athletics' && (!athleticsHouses || athleticsHouses.length < 2)) {
      throw new Error('An Athletics session needs at least two active houses.');
    }
    const athleticsEvents = mode === 'athletics'
      ? (Array.isArray(data.athleticsEvents) ? data.athleticsEvents.map((event, index) => {
        const category = normalizeAthleticsCategory(event.category);
        if (!['running', 'shot-put', 'relay'].includes(category)) {
          throw new Error(`Event "${event.name || index + 1}" has an unsupported athletics type.`);
        }
        const eventName = text(event.name, 'Event name', 100, true);
        if (!event.athletes || typeof event.athletes !== 'object' || Array.isArray(event.athletes)) {
          throw new Error(`Event "${eventName}" is missing its athlete assignments.`);
        }
        const assignments = {};
        const shortCodeAssignments = {};
        for (const [houseId, rawNames] of Object.entries(event.athletes)) {
          if (!athleticsHouses.some(house => house.id === houseId)) {
            throw new Error(`Event "${eventName}" contains an unknown house assignment.`);
          }
          if (!Array.isArray(rawNames)) throw new Error(`Athletes for ${eventName} must be a list.`);
          const names = rawNames.map(name => text(name, 'Athlete name', 80, true));
          const maxNames = category === 'relay' ? 8 : 32;
          if (names.length > maxNames) throw new Error(`A house can have at most ${maxNames} athletes in "${eventName}".`);
          if (new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) {
            throw new Error(`Remove duplicate athlete names from ${eventName}.`);
          }
          if (category === 'relay' && names.length > 0 && names.length < 2) {
            throw new Error(`Relay teams need at least 2 runners in "${eventName}".`);
          }
          if (names.length) assignments[houseId] = names;
          if (names.length) {
            const suppliedCodes = event.athleteShortCodes?.[houseId] || {};
            const codes = names.map(name => {
              const supplied = typeof suppliedCodes[name] === 'string' ? suppliedCodes[name].trim().toUpperCase() : '';
              const code = supplied || defaultAthleteShortCode(name);
              if (!/^[A-Z0-9]{1,4}$/.test(code)) throw new Error(`Athlete shortcode for ${name} must contain 1 to 4 letters or numbers.`);
              return code;
            });
            if (new Set(codes).size !== codes.length) throw new Error(`Athlete shortcodes must be unique within ${athleticsHouses.find(house => house.id === houseId)?.name || 'each house'} in "${eventName}".`);
            shortCodeAssignments[houseId] = Object.fromEntries(names.map((name, index) => [name, codes[index]]));
          }
        }
        if (!Object.values(assignments).some(names => names.length > 0)) {
          throw new Error(`Event "${eventName}" needs at least one athlete assigned.`);
        }
        return {
          id: text(event.id, 'Event ID', 100, true), name: eventName, category, athletes: assignments,
          athleteShortCodes: shortCodeAssignments,
          resultRequired: category === 'shot-put' || event.resultRequired !== false,
          liveStandings: event.liveStandings !== false
        };
      }) : [])
      : null;
    this.activeSession = {
      id: crypto.randomUUID(),
      mode: 'sport',
      sportId: mode,
      modeId: mode,
      status: 'SETUP',
      competition,
      teams,
      participantIds: [],
      sportState: {
        ...this._initialSportState(mode),
        ...(racketMatch ? {
          racketMatch,
          ...(mode === 'table-tennis' ? {
            tableTennis: {
              format: racketMatch.format,
              players: Object.fromEntries(['home', 'away'].map(side => [
                side, racketMatch.players[side].map(player => player.name)
              ]))
            }
          } : {})
        } : {})
      },
      participants: [],
      athletics: mode === 'athletics' ? {
        houses: athleticsHouses,
        events: athleticsEvents,
        currentEvent: null,
        results: [],
        displayMode: 'live'
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
      racketMatch: ['table-tennis', 'badminton'].includes(mode) ? {
        format: 'singles',
        players: { home: [], away: [] }
      } : null,
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
      color: '#64748b',
      runners: []
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

  setAthleticsHouseRunners(houseId, runners) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('House runners can only be managed in an Athletics session.');
    const house = session.athletics.houses.find(item => item.id === houseId);
    if (!house) throw new Error('Select a house before setting its runners.');
    if (!Array.isArray(runners)) throw new Error('Runners must be an array.');
    const cleaned = runners.map(name => String(name).trim()).filter(Boolean);
    if (cleaned.length > 8) throw new Error('A house can have at most 8 runners.');
    cleaned.forEach(name => {
      if (name.length > 80) throw new Error('Runner name must not exceed 80 characters.');
    });
    house.runners = cleaned;
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
    if (typeof input.eventId === 'string' && input.eventId.trim()) {
      const scheduled = session.athletics.events.find(event => event.id === input.eventId.trim());
      if (!scheduled) throw new Error('Select an event from this Athletics session schedule.');
      let results = scheduled.resultRequired === false
        ? (Array.isArray(scheduled.results) ? scheduled.results : [])
        : session.athletics.results.filter(result => result.eventId === scheduled.id);
      if (scheduled.resultRequired === false && results.length === 0) {
        const houseById = new Map(session.athletics.houses.map(house => [house.id, house]));
        results = Object.entries(scheduled.athletes || {}).flatMap(([houseId, names]) => {
          const house = houseById.get(houseId);
          if (!house) return [];
          if (scheduled.category === 'relay') {
            return names.length >= 2 ? [{ id: crypto.randomUUID(), athleteName: names.join(' → '), runnerNames: names, team: house.name, result: '', place: 0, points: 0 }] : [];
          }
          return names.map(name => ({ id: crypto.randomUUID(), athleteName: name, runnerNames: [], team: house.name, result: '', place: 0, points: 0 }));
        }).map((result, index) => ({ ...result, place: index + 1 }));
      }
      session.athletics.currentEvent = { ...scheduled, results };
      session.athletics.displayMode = 'live';
      this._persist();
      return this._copySession();
    }
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) throw new Error('Event name must contain 1 to 100 characters.');
    const category = normalizeAthleticsCategory(input.category);
    if (!['running', 'shot-put', 'relay'].includes(category)) {
      throw new Error('Event category must be Running, Shot Put, or Baton Relay.');
    }
    if (session.athletics.currentEvent) {
      session.athletics.currentEvent.name = name;
      session.athletics.currentEvent.category = category;
      const scheduled = session.athletics.events.find(event => event.id === session.athletics.currentEvent.id);
      if (scheduled) {
        scheduled.name = name;
        scheduled.category = category;
      }
    } else {
      session.athletics.currentEvent = { id: crypto.randomUUID(), name, category, results: [] };
    }
    this._persist();
    return this._copySession();
  }

  setAthleticsDisplayMode(mode) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('Live and After views are only available in Athletics.');
    if (!['live', 'after'].includes(mode)) throw new Error('Choose either Live or After results.');
    session.athletics.displayMode = mode;
    this._persist();
    return this._copySession();
  }

  setAthleticsLiveStandings(enabled) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics' || !session.athletics.currentEvent) {
      throw new Error('Select a live Athletics event first.');
    }
    if (typeof enabled !== 'boolean') throw new Error('Choose whether live standings should be shown.');
    const event = session.athletics.currentEvent;
    event.liveStandings = enabled;
    const scheduled = session.athletics.events.find(item => item.id === event.id);
    if (scheduled) scheduled.liveStandings = enabled;
    this._persist();
    return this._copySession();
  }

  reorderAthleticsResults(resultIds) {
    const session = this._requireActiveSession();
    const event = session.athletics.currentEvent;
    if (session.modeId !== 'athletics' || !event) throw new Error('Select a live Athletics event first.');
    if (session.athletics.displayMode === 'after') throw new Error('Return to Live mode before changing the standings.');
    if (event.category === 'shot-put') throw new Error('Shot Put standings are ranked by each athlete’s best distance.');
    if (!Array.isArray(resultIds) || resultIds.length !== event.results.length ||
        new Set(resultIds).size !== resultIds.length || resultIds.some(id => !event.results.some(result => result.id === id))) {
      throw new Error('The new standings order is invalid.');
    }
    const ordered = resultIds.map(id => event.results.find(result => result.id === id));
    ordered.forEach((result, index) => {
      result.place = index + 1;
      result.points = event.resultRequired === false ? 0 : ({ 1: 5, 2: 3, 3: 1 }[result.place] || 0);
    });
    event.results = ordered;
    if (event.resultRequired === false) {
      const scheduled = session.athletics.events.find(item => item.id === event.id);
      if (scheduled) scheduled.results = ordered;
    } else {
      session.athletics.results = session.athletics.results.filter(result => result.eventId !== event.id);
      session.athletics.results.push(...ordered.map(result => ({ eventId: event.id, eventName: event.name, ...result })));
    }
    this._persist();
    return this._copySession();
  }

  transferAthleticsBaton(resultId) {
    const session = this._requireActiveSession();
    const event = session.athletics.currentEvent;
    if (session.modeId !== 'athletics' || !event || event.category !== 'relay') {
      throw new Error('Select a live relay event first.');
    }
    if (session.athletics.displayMode === 'after') {
      throw new Error('Return to Live mode before transferring the baton.');
    }
    const result = event.results.find(item => item.id === resultId);
    if (!result || !Array.isArray(result.runnerNames) || result.runnerNames.length < 2) {
      throw new Error('This relay team has no next runner to transfer to.');
    }
    const currentIndex = Number.isInteger(result.currentRunnerIndex) ? result.currentRunnerIndex : 0;
    if (currentIndex >= result.runnerNames.length - 1) {
      throw new Error('This relay team has completed all baton transfers.');
    }
    const runnerIndex = currentIndex + 1;
    result.currentRunnerIndex = runnerIndex;
    this._persist();
    return {
      eventId: event.id,
      resultId,
      runnerIndex,
      nextRunnerName: result.runnerNames[runnerIndex],
      complete: runnerIndex === result.runnerNames.length - 1,
      standings: this.getAthleticsBroadcastState()
    };
  }

  updateAthleticsResult(input) {
    const session = this._requireActiveSession();
    const event = session.athletics.currentEvent;
    if (session.modeId !== 'athletics' || !event) throw new Error('Select a live Athletics event first.');
    if (session.athletics.displayMode === 'after') throw new Error('Return to Live mode before editing results.');
    if (event.resultRequired === false) throw new Error('This event uses roster order and does not accept timed results.');
    if (event.category === 'shot-put') throw new Error('Correct Shot Put by saving the affected athlete’s turn again.');
    if (!input || typeof input !== 'object') throw new Error('Result details are required.');
    const result = event.results.find(item => item.id === input?.resultId);
    if (!result) throw new Error('The Athletics result to edit was not found.');
    const athleteName = typeof input.athleteName === 'string' ? input.athleteName.trim() : '';
    const team = typeof input.team === 'string' ? input.team.trim() : '';
    const value = typeof input.result === 'string' ? input.result.trim() : '';
    const place = Number(input.place);
    const runnerNames = Array.isArray(input.runnerNames)
      ? input.runnerNames.map(name => typeof name === 'string' ? name.trim() : '').filter(Boolean)
      : [];
    const house = session.athletics.houses.find(item => item.name === team);
    if (!house) throw new Error('Select a house configured for this Athletics session.');
    if (event.category === 'relay' && event.results.some(item => item.id !== result.id && item.team === team)) {
      throw new Error('A relay event can have one team result per house. Edit that house’s existing result instead.');
    }
    if (!value || value.length > 80) throw new Error('Enter a result, time, or distance.');
    if (!Number.isInteger(place) || place < 1 || place > event.results.length) {
      throw new Error(`Place must be between 1 and ${event.results.length}.`);
    }
    if (event.category === 'relay') {
      if (runnerNames.length < 2 || runnerNames.length > 8) throw new Error('A relay needs 2 to 8 runners.');
      const roster = event.athletes?.[house.id];
      if (Array.isArray(roster) && (roster.length !== runnerNames.length || roster.some((name, index) => name !== runnerNames[index]))) {
        throw new Error(`Use ${house.name}’s assigned runners in their saved handoff order.`);
      }
      result.runnerNames = runnerNames;
      result.athleteName = runnerNames.join(' → ');
    } else {
      if (!athleteName || athleteName.length > 80) throw new Error('Choose an assigned athlete.');
      const roster = event.athletes?.[house.id];
      if (event.athletes && Object.keys(event.athletes).length && !Array.isArray(roster)) {
        throw new Error(`No athletes from ${house.name} are assigned to this event.`);
      }
      if (Array.isArray(roster) && !roster.includes(athleteName)) throw new Error(`Choose an athlete assigned to ${house.name}.`);
      result.athleteName = athleteName;
      result.runnerNames = [];
    }
    result.team = team;
    result.result = value;
    event.results.sort((a, b) => a.place - b.place || (a.recordedAt || '').localeCompare(b.recordedAt || ''));
    event.results.splice(event.results.indexOf(result), 1);
    event.results.splice(place - 1, 0, result);
    event.results.forEach((item, index) => {
      item.place = index + 1;
      item.points = ({ 1: 5, 2: 3, 3: 1 }[item.place] || 0);
    });
    session.athletics.results = session.athletics.results.filter(item => item.eventId !== event.id);
    session.athletics.results.push(...event.results.map(item => ({ eventId: event.id, eventName: event.name, ...item })));
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
      displayMode: session.athletics.displayMode === 'after' ? 'after' : 'live',
      event: event ? {
        id: event.id,
        name: event.name,
        category: event.category,
        resultRequired: event.resultRequired !== false,
        liveStandings: event.liveStandings !== false,
        athletes: event.athletes || {},
        athleteShortCodes: event.athleteShortCodes || {},
        results: event.results.map(result => ({
          id: result.id,
          place: result.place,
          athleteName: result.athleteName,
          runnerNames: result.runnerNames || [],
          currentRunnerIndex: Number.isInteger(result.currentRunnerIndex) ? result.currentRunnerIndex : 0,
          team: result.team,
          result: result.result,
          points: result.points,
          attempts: result.attempts || []
        }))
      } : null,
      houses: session.athletics.houses.map(house => ({
        id: house.id,
        name: house.name,
        logo: house.logo,
        color: house.color,
        runners: event?.athletes?.[house.id] || house.runners || []
      }))
    };
  }

  recordAthleticsResult(input) {
    const session = this._requireActiveSession();
    if (session.modeId !== 'athletics') throw new Error('Results can only be recorded in an Athletics session.');
    const event = session.athletics.currentEvent;
    if (!event) throw new Error('Set the live Athletics event title and category first.');
    if (session.athletics.displayMode === 'after') throw new Error('Return to Live mode before recording results.');
    if (event.resultRequired === false) throw new Error('This event uses roster order and does not accept timed results.');
    const participant = typeof input.participantId === 'string'
      ? session.participants.find(item => item.id === input.participantId)
      : null;
    const athleteName = participant?.name || (typeof input.athleteName === 'string' ? input.athleteName.trim() : '');
    const team = typeof input.team === 'string' ? input.team.trim() : '';
    const house = session.athletics.houses.find(item => item.name === team);
    if (!house) throw new Error('Select a house configured for this Athletics session.');
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
      if (event.results.some(item => item.team === team)) {
        throw new Error('A relay event can have one team result per house.');
      }
    } else if (!athleteName || athleteName.length > 80) {
      throw new Error('Athlete name is required.');
    }
    const roster = event.athletes?.[house.id];
    if (event.athletes && Object.keys(event.athletes).length && !Array.isArray(roster)) {
      throw new Error(`No athletes from ${house.name} are assigned to this event.`);
    }
    if (Array.isArray(roster)) {
      const validRoster = names => names.length === roster.length && names.every((name, index) => name === roster[index]);
      if (event.category === 'relay' && !validRoster(runnerNames)) {
        throw new Error(`Use the assigned runners for ${house.name} in their saved handoff order.`);
      }
      if (event.category !== 'relay' && !roster.includes(athleteName)) {
        throw new Error(`Choose an athlete assigned to ${house.name} for this event.`);
      }
    }
    if (event.category === 'shot-put') {
      return this._recordShotPutAttempt(session, event, athleteName, team, input);
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
    const isFoul = input.foul === true;
    const distance = isFoul ? null : Number(input.distance);
    if (!athleteName || athleteName.length > 80) throw new Error('Athlete name is required.');
    if (!team || team.length > 60) throw new Error('House/team is required.');
    if (!session.athletics.houses.some(house => house.name === team)) {
      throw new Error('Select a house configured for this Athletics session.');
    }
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > 6) {
      throw new Error('Shot Put turn must be a whole number from 1 to 6.');
    }
    if (!isFoul && (!Number.isFinite(distance) || distance <= 0 || distance > 100)) {
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
    entry.attempts[attempt - 1] = isFoul ? null : Number(distance.toFixed(2));
    const valid = entry.attempts.filter(Number.isFinite);
    entry.bestDistance = valid.length ? Math.max(...valid) : null;
    entry.result = entry.bestDistance ? `${entry.bestDistance.toFixed(2)} m` : '—';

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
    if (session.athletics.displayMode === 'after') throw new Error('Return to Live mode before changing results.');
    if (event?.resultRequired === false) throw new Error('Roster-only runners cannot be removed from the event standings.');
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
      b.points - a.points || b.medals.gold - a.medals.gold || b.medals.silver - a.medals.silver ||
      b.medals.bronze - a.medals.bronze || a.team.localeCompare(b.team)
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
    const discardedId = this.activeSession?.id;
    this.activeSession = null;
    this._persist();
    if (discardedId) {
      const safeId = String(discardedId).replace(/[^a-zA-Z0-9_-]/g, '');
      const sessionPath = path.join(this.sessionsDirectory, `${safeId}.json`);
      if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    }
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
