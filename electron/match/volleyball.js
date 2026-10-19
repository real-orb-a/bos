const EventEmitter = require('events');
const { randomUUID } = require('crypto');
const VolleyballStore = require('./volleyballStore');

const DEFAULT_RULES = Object.freeze({
  bestOf: 5,
  regularSetTarget: 25,
  decidingSetTarget: 15,
  winByTwo: true,
  timeoutAllowance: 2,
  timeoutDurationSeconds: 30,
  timeoutResetPolicy: 'eachSet',
  sideChangePrompts: { atSetEnd: false, decidingSetPoints: [] },
  announcementMaxChars: 240,
  completedResultLimit: 0
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });

function validName(value, label, maxLength) {
  if (typeof value !== 'string') throw fail('INVALID_SETUP', `${label} must be text.`);
  const name = value.trim();
  if (!name) throw fail('INVALID_SETUP', `${label} is required.`);
  if (Array.from(name).length > maxLength) throw fail('INVALID_SETUP', `${label} must be ${maxLength} characters or fewer.`);
  return name;
}

function validateRules(input = {}) {
  const rules = { ...DEFAULT_RULES, ...input };
  const prompts = { ...DEFAULT_RULES.sideChangePrompts, ...(input.sideChangePrompts || {}) };
  const integer = (value, label, min, max) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw fail('INVALID_SETUP', `${label} must be a whole number from ${min} to ${max}.`);
    }
    return value;
  };

  rules.bestOf = integer(rules.bestOf, 'Number of sets', 1, 9);
  if (rules.bestOf % 2 === 0) throw fail('INVALID_SETUP', 'Number of sets must be odd.');
  rules.setsToWin = Math.floor(rules.bestOf / 2) + 1;
  rules.regularSetTarget = integer(rules.regularSetTarget, 'Regular-set points target', 1, 99);
  rules.decidingSetTarget = integer(rules.decidingSetTarget, 'Deciding-set points target', 1, 99);
  if (typeof rules.winByTwo !== 'boolean') throw fail('INVALID_SETUP', 'Win-by-two must be enabled or disabled.');
  rules.timeoutAllowance = integer(rules.timeoutAllowance, 'Timeout allowance', 0, 20);
  rules.timeoutDurationSeconds = integer(rules.timeoutDurationSeconds, 'Timeout duration', 1, 3600);
  if (!['eachSet', 'match'].includes(rules.timeoutResetPolicy)) {
    throw fail('INVALID_SETUP', 'Timeout reset policy must be eachSet or match.');
  }
  rules.announcementMaxChars = integer(rules.announcementMaxChars, 'Announcement character limit', 1, 2000);
  rules.completedResultLimit = integer(rules.completedResultLimit, 'Completed-result retention limit', 0, 10000);
  if (typeof prompts.atSetEnd !== 'boolean') throw fail('INVALID_SETUP', 'Set-end side prompt must be enabled or disabled.');
  if (!Array.isArray(prompts.decidingSetPoints)) throw fail('INVALID_SETUP', 'Deciding-set side prompts must be a list of point values.');
  prompts.decidingSetPoints = [...new Set(prompts.decidingSetPoints.map((point) =>
    integer(point, 'Deciding-set side-change point', 1, rules.decidingSetTarget - 1)
  ))].sort((a, b) => a - b);
  rules.sideChangePrompts = prompts;
  return rules;
}

class VolleyballEngine extends EventEmitter {
  constructor(store, options = {}) {
    super();
    if (!(store instanceof VolleyballStore) && (!store || typeof store.getData !== 'function' || typeof store.save !== 'function')) {
      throw new TypeError('A VolleyballStore-compatible store is required.');
    }
    this.store = store;
    this.now = options.now || (() => Date.now());
    this.makeId = options.makeId || (() => randomUUID());
    this.data = this.store.getData();
    this.timer = null;
    this.lastPublishedRemaining = null;
    this.recoveryPersistenceError = null;
    this._recoverActiveTimeout();
    this._syncTimer();
  }

  _recoverActiveTimeout() {
    const match = this.data.activeMatch;
    const timeout = match && match.activeTimeout;
    if (!timeout || timeout.status !== 'ACTIVE') return;

    const candidate = clone(this.data);
    const recoveredMatch = candidate.activeMatch;
    const recoveredTimeout = recoveredMatch.activeTimeout;
    recoveredTimeout.remainingAtRecovery = Math.max(0, Math.ceil((recoveredTimeout.deadlineAt - this.now()) / 1000));
    recoveredTimeout.status = 'RECOVERY_REVIEW';
    recoveredTimeout.recoveredAt = this.now();
    this._syncTimeoutRecord(recoveredMatch, recoveredTimeout);
    this._appendAction(recoveredMatch, 'TIMEOUT_RECOVERY_REQUIRED', {
      timeoutId: recoveredTimeout.id,
      remainingSeconds: recoveredTimeout.remainingAtRecovery
    });
    candidate.revision++;
    try {
      this.store.save(candidate);
      this.data = candidate;
    } catch (error) {
      this.recoveryPersistenceError = error.message;
    }
  }

  getStatus() {
    return {
      storage: this.store.getStatus(),
      recoveryPersistenceError: this.recoveryPersistenceError
    };
  }

  getState() {
    const state = clone(this.data);
    const match = state.activeMatch;
    if (match && match.activeTimeout) {
      const timeout = match.activeTimeout;
      timeout.remainingSeconds = timeout.status === 'ACTIVE'
        ? Math.max(0, Math.ceil((timeout.deadlineAt - this.now()) / 1000))
        : (timeout.status === 'RECOVERY_REVIEW' ? timeout.remainingAtRecovery : 0);
    }
    state.storage = this.getStatus();
    return state;
  }

  _assertWritable() {
    if (this.recoveryPersistenceError) {
      throw fail('STORAGE_RECOVERY_REQUIRED', `Timeout recovery could not be saved: ${this.recoveryPersistenceError}`);
    }
    if (this.store.getStatus().writesBlocked) {
      throw fail('STORAGE_RECOVERY_REQUIRED', 'Volleyball storage is read-only until its recovery problem is resolved.');
    }
  }

  _commit(mutator) {
    this._assertWritable();
    const candidate = clone(this.data);
    mutator(candidate);
    candidate.revision = this.data.revision + 1;
    this.store.save(candidate);
    this.data = candidate;
    this.recoveryPersistenceError = null;
    this._syncTimer();
    this._publish('changed');
    return this.getState();
  }

  _publish(eventName) {
    const payload = this.getState();
    for (const listener of this.rawListeners(eventName)) {
      try {
        listener.call(this, payload);
      } catch (error) {
        console.error(`[Volleyball] ${eventName} listener failed after commit:`, error.message);
      }
    }
  }

  _appendAction(match, type, details = {}) {
    const action = { id: this.makeId(), type, at: this.now(), ...clone(details) };
    match.actionHistory.push(action);
    return action;
  }

  _requireMatch(candidate = this.data) {
    if (!candidate.activeMatch) throw fail('NO_ACTIVE_MATCH', 'There is no active Volleyball match.');
    return candidate.activeMatch;
  }

  _requireAnnouncementRecord(candidate) {
    if (candidate.activeMatch) return candidate.activeMatch;
    const result = [...candidate.completedResults].reverse().find((entry) => !entry.supersededBy);
    if (!result) throw fail('NO_MATCH', 'Create a Volleyball match before publishing an announcement.');
    return result;
  }

  _requireTeam(match, teamId) {
    if (!match.teams[teamId]) throw fail('INVALID_TEAM', 'Select a team from this match.');
    return match.teams[teamId];
  }

  _requireStatus(match, ...statuses) {
    if (!statuses.includes(match.status)) {
      throw fail('INVALID_STATE', `This operation is not allowed while the match is ${match.status}.`);
    }
  }

  _currentSet(match) {
    const set = match.sets.find((entry) => entry.number === match.currentSetNumber);
    if (!set) throw fail('INVALID_STATE', 'The current set record is missing.');
    return set;
  }

  _newSet(match, number) {
    const deciding = match.rules.bestOf > 1 && number === match.rules.bestOf;
    return {
      number,
      target: deciding ? match.rules.decidingSetTarget : match.rules.regularSetTarget,
      points: { [match.homeTeamId]: 0, [match.awayTeamId]: 0 },
      status: 'READY',
      winnerTeamId: null,
      startedAt: null,
      completedAt: null
    };
  }

  _isSetWinner(match, set) {
    const [homePoints, awayPoints] = [set.points[match.homeTeamId], set.points[match.awayTeamId]];
    if (homePoints === awayPoints) return null;
    const teamId = homePoints > awayPoints ? match.homeTeamId : match.awayTeamId;
    const points = set.points[teamId];
    const otherPoints = set.points[teamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId];
    const margin = match.rules.winByTwo ? 2 : 1;
    return points >= set.target && points - otherPoints >= margin ? teamId : null;
  }

  _setsWon(match) {
    return {
      [match.homeTeamId]: match.sets.filter((set) => set.status === 'COMPLETE' && set.winnerTeamId === match.homeTeamId).length,
      [match.awayTeamId]: match.sets.filter((set) => set.status === 'COMPLETE' && set.winnerTeamId === match.awayTeamId).length
    };
  }

  _activeTimeout(match) {
    return match.activeTimeout && !['ENDED', 'CANCELLED'].includes(match.activeTimeout.status)
      ? match.activeTimeout
      : null;
  }

  _syncTimeoutRecord(match, timeout) {
    const record = match.timeoutRecords.find((entry) => entry.id === timeout.id);
    if (record && record !== timeout) Object.assign(record, clone(timeout));
  }

  _timeoutUsage(match, teamId, setNumber = match.currentSetNumber) {
    const records = match.timeoutRecords.filter((timeout) => timeout.teamId === teamId && timeout.status !== 'CANCELLED');
    const relevant = match.rules.timeoutResetPolicy === 'eachSet'
      ? records.filter((timeout) => timeout.setNumber === setNumber)
      : records;
    return relevant.length;
  }

  _maybeDecidingSetPrompt(match, set, triggerStatus) {
    if (!['SET_ACTIVE', 'SET_WON_PENDING_CONFIRMATION'].includes(triggerStatus) || set.number !== match.rules.bestOf || match.pendingSideSwitchPrompt) return;
    const point = Math.max(set.points[match.homeTeamId], set.points[match.awayTeamId]);
    if (!match.rules.sideChangePrompts.decidingSetPoints.includes(point)) return;
    const key = `DECIDING_SET_POINT_${point}`;
    if (match.resolvedSidePromptKeys.includes(key)) return;
    match.pendingSideSwitchPrompt = {
      id: this.makeId(),
      key,
      reason: `The configured deciding-set prompt point ${point} has been reached.`,
      status: 'PENDING',
      resumeStatus: triggerStatus,
      createdAt: this.now()
    };
    match.status = 'SIDE_SWITCH_REVIEW';
  }

  createMatch(setup) {
    this._assertWritable();
    if (this.data.activeMatch) throw fail('ACTIVE_MATCH_EXISTS', 'Finish or explicitly correct the active match before creating another.');
    if (!setup || typeof setup !== 'object') throw fail('INVALID_SETUP', 'Match setup is required.');
    const rules = validateRules(setup.rules || {});
    const competitionName = validName(setup.competitionName, 'Competition name', 80);
    const matchName = validName(setup.matchName, 'Match name', 80);
    const homeName = validName(setup.homeTeamName, 'Home team name', 48);
    const awayName = validName(setup.awayTeamName, 'Away team name', 48);
    if (homeName.toLocaleLowerCase() === awayName.toLocaleLowerCase()) {
      throw fail('INVALID_SETUP', 'Home and away team names must be different.');
    }
    const homeTeamId = this.makeId();
    const awayTeamId = this.makeId();
    const servingSide = setup.startingServeTeam === 'away' ? 'away' : setup.startingServeTeam === 'home' ? 'home' : null;
    if (!servingSide) throw fail('INVALID_SETUP', 'Choose which team serves first.');

    return this._commit((candidate) => {
      const match = {
        id: this.makeId(),
        matchId: null,
        competitionName,
        matchName,
        createdAt: this.now(),
        startedAt: null,
        completedAt: null,
        status: 'READY',
        rules,
        homeTeamId,
        awayTeamId,
        teams: {
          [homeTeamId]: { id: homeTeamId, name: homeName },
          [awayTeamId]: { id: awayTeamId, name: awayName }
        },
        currentSetNumber: 1,
        sets: [this._newSet({ homeTeamId, awayTeamId, rules }, 1)],
        setsToWin: rules.setsToWin,
        servingTeamId: servingSide === 'home' ? homeTeamId : awayTeamId,
        courtSides: { leftTeamId: homeTeamId, rightTeamId: awayTeamId },
        timeoutRecords: [],
        activeTimeout: null,
        pendingSideSwitchPrompt: null,
        resolvedSidePromptKeys: [],
        announcement: { revision: 0, live: null, lastRequestId: null },
        actionHistory: [],
        correctionOf: null,
        resultRevision: 1
      };
      match.matchId = match.id;
      this._appendAction(match, 'MATCH_CREATED', { competitionName, matchName });
      candidate.activeMatch = match;
    });
  }

  startMatch() {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      this._requireStatus(match, 'READY');
      const set = this._currentSet(match);
      match.status = 'SET_ACTIVE';
      set.status = 'ACTIVE';
      set.startedAt = this.now();
      match.startedAt = this.now();
      this._appendAction(match, 'MATCH_STARTED', { setNumber: set.number });
    });
  }

  scorePoint(teamId) {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      if (match.pendingSideSwitchPrompt && match.pendingSideSwitchPrompt.status !== 'DEFERRED') {
        throw fail('SIDE_PROMPT_PENDING', 'Resolve the side-switch prompt before scoring another point.');
      }
      this._requireStatus(match, 'SET_ACTIVE');
      if (this._activeTimeout(match)) throw fail('TIMEOUT_ACTIVE', 'Resolve the active timeout before scoring another point.');
      this._requireTeam(match, teamId);
      const set = this._currentSet(match);
      if (set.status !== 'ACTIVE') throw fail('INVALID_STATE', 'The current set is not active.');
      const before = { points: clone(set.points), servingTeamId: match.servingTeamId };
      set.points[teamId]++;
      match.servingTeamId = teamId;
      const winner = this._isSetWinner(match, set);
      if (winner) {
        set.status = 'AWAITING_RESULT_CONFIRMATION';
        match.status = 'SET_WON_PENDING_CONFIRMATION';
        set.pendingWinnerTeamId = winner;
      }
      this._appendAction(match, 'POINT_SCORED', {
        setNumber: set.number,
        teamId,
        before,
        after: { points: clone(set.points), servingTeamId: match.servingTeamId }
      });
      this._maybeDecidingSetPrompt(match, set, match.status);
    });
  }

  undoLastPoint(reason) {
    const correctionReason = validName(reason, 'Correction reason', 300);
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      this._requireStatus(match, 'SET_ACTIVE', 'SET_WON_PENDING_CONFIRMATION');
      if (this._activeTimeout(match) || match.pendingSideSwitchPrompt) {
        throw fail('INVALID_STATE', 'Resolve the timeout or side prompt before correcting the point.');
      }
      const last = match.actionHistory[match.actionHistory.length - 1];
      const set = this._currentSet(match);
      if (!last || last.type !== 'POINT_SCORED' || last.setNumber !== set.number || last.undoneBy) {
        throw fail('UNDO_NOT_AVAILABLE', 'Only the most recent uncorrected point in this set can be undone.');
      }
      set.points = clone(last.before.points);
      set.status = 'ACTIVE';
      delete set.pendingWinnerTeamId;
      match.servingTeamId = last.before.servingTeamId;
      match.status = 'SET_ACTIVE';
      last.undoneBy = this.makeId();
      this._appendAction(match, 'POINT_UNDONE', { targetActionId: last.id, reason: correctionReason });
    });
  }

  recordSetResult(options = {}) {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      this._requireStatus(match, 'SET_WON_PENDING_CONFIRMATION');
      if (this._activeTimeout(match)) throw fail('TIMEOUT_ACTIVE', 'End or cancel the timeout before recording the set result.');
      if (match.pendingSideSwitchPrompt && match.pendingSideSwitchPrompt.status !== 'DEFERRED') {
        throw fail('SIDE_PROMPT_PENDING', 'Resolve the side-switch prompt before recording the set result.');
      }
      const set = this._currentSet(match);
      const winnerTeamId = this._isSetWinner(match, set);
      if (!winnerTeamId || winnerTeamId !== set.pendingWinnerTeamId) {
        throw fail('SET_NOT_WON', 'The configured set-winning conditions have not been met.');
      }
      set.status = 'COMPLETE';
      set.winnerTeamId = winnerTeamId;
      set.completedAt = this.now();
      delete set.pendingWinnerTeamId;
      this._appendAction(match, 'SET_RESULT_RECORDED', { setNumber: set.number, winnerTeamId, points: clone(set.points) });

      const setsWon = this._setsWon(match);
      const matchWinnerId = Object.entries(setsWon).find(([, count]) => count >= match.setsToWin)?.[0] || null;
      if (matchWinnerId) {
        this._completeMatch(candidate, match, matchWinnerId, options.confirmRetention === true);
        return;
      }
      match.status = 'BETWEEN_SETS';
      if (match.rules.sideChangePrompts.atSetEnd) {
        const key = `SET_END_${set.number}`;
        if (!match.resolvedSidePromptKeys.includes(key)) {
          match.pendingSideSwitchPrompt = {
            id: this.makeId(),
            key,
            reason: `The configured set-end side-change prompt for set ${set.number} is due.`,
            status: 'PENDING',
            resumeStatus: 'BETWEEN_SETS',
            createdAt: this.now()
          };
          match.status = 'SIDE_SWITCH_REVIEW';
        }
      }
    });
  }

  _completeMatch(candidate, match, winnerTeamId, confirmRetention) {
    const limit = match.rules.completedResultLimit;
    const overLimit = limit > 0 && candidate.completedResults.length >= limit;
    if (overLimit && !confirmRetention) {
      throw fail('RESULT_RETENTION_CONFIRMATION_REQUIRED', 'Completing this match will remove the oldest completed result under the configured retention limit.', {
        oldestResultId: candidate.completedResults[0] && candidate.completedResults[0].id,
        limit
      });
    }
    match.status = 'MATCH_COMPLETE';
    match.completedAt = this.now();
    match.winnerTeamId = winnerTeamId;
    match.finalSetsWon = this._setsWon(match);
    this._appendAction(match, 'MATCH_COMPLETED', { winnerTeamId, finalSetsWon: clone(match.finalSetsWon) });
    const result = clone(match);
    result.matchId = match.matchId || match.id;
    if (overLimit) {
      const pruned = candidate.completedResults.shift();
      this._appendAction(match, 'RESULT_RETENTION_PRUNED', { resultId: pruned.id, confirmed: true });
    }
    result.resultRevision = match.resultRevision || 1;
    candidate.completedResults.push(result);
    candidate.activeMatch = null;
  }

  advanceSet() {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      this._requireStatus(match, 'BETWEEN_SETS');
      if (this._activeTimeout(match)) throw fail('TIMEOUT_ACTIVE', 'Resolve the active timeout before advancing sets.');
      if (match.pendingSideSwitchPrompt && match.pendingSideSwitchPrompt.status !== 'DEFERRED') {
        throw fail('SIDE_PROMPT_PENDING', 'Resolve the side-switch prompt before advancing sets.');
      }
      const nextNumber = match.currentSetNumber + 1;
      if (nextNumber > match.rules.bestOf) throw fail('INVALID_STATE', 'The configured maximum number of sets has been reached.');
      match.currentSetNumber = nextNumber;
      match.sets.push(this._newSet(match, nextNumber));
      match.sets[match.sets.length - 1].status = 'ACTIVE';
      match.sets[match.sets.length - 1].startedAt = this.now();
      match.status = 'SET_ACTIVE';
      this._appendAction(match, 'SET_STARTED', { setNumber: nextNumber, target: match.sets[match.sets.length - 1].target });
    });
  }

  startTimeout(teamId, options = {}) {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      this._requireStatus(match, 'SET_ACTIVE');
      if (match.pendingSideSwitchPrompt) throw fail('SIDE_PROMPT_PENDING', 'Resolve the side-switch prompt before starting a timeout.');
      if (this._activeTimeout(match)) throw fail('TIMEOUT_ACTIVE', 'A timeout is already active.');
      this._requireTeam(match, teamId);
      const used = this._timeoutUsage(match, teamId);
      const override = options.overrideConfirmed === true;
      if (used >= match.rules.timeoutAllowance && !override) {
        throw fail('TIMEOUT_ALLOWANCE_EXHAUSTED', 'This team has used its configured timeout allowance.');
      }
      const reason = options.overrideReason === undefined ? '' : String(options.overrideReason).trim();
      if (override && Array.from(reason).length < 5) {
        throw fail('OVERRIDE_REASON_REQUIRED', 'Enter a reason of at least 5 characters for the timeout override.');
      }
      const timeout = {
        id: this.makeId(),
        teamId,
        setNumber: match.currentSetNumber,
        calledAt: this.now(),
        deadlineAt: this.now() + match.rules.timeoutDurationSeconds * 1000,
        durationSeconds: match.rules.timeoutDurationSeconds,
        status: 'ACTIVE',
        override,
        overrideReason: override ? reason : null,
        timerElapsedAt: null
      };
      match.timeoutRecords.push(timeout);
      match.activeTimeout = timeout;
      this._appendAction(match, override ? 'TIMEOUT_OVERRIDE_STARTED' : 'TIMEOUT_STARTED', {
        timeoutId: timeout.id,
        teamId,
        setNumber: timeout.setNumber,
        overrideReason: timeout.overrideReason
      });
    });
  }

  endTimeout(reason = '') {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      const timeout = this._activeTimeout(match);
      if (!timeout || !['ACTIVE', 'TIMER_ELAPSED_AWAITING_OPERATOR'].includes(timeout.status)) {
        throw fail('NO_ACTIVE_TIMEOUT', 'There is no timeout awaiting operator end.');
      }
      timeout.status = 'ENDED';
      timeout.endedAt = this.now();
      timeout.endReason = String(reason || 'Operator ended timeout').trim();
      this._syncTimeoutRecord(match, timeout);
      match.activeTimeout = null;
      this._appendAction(match, 'TIMEOUT_ENDED_BY_OPERATOR', { timeoutId: timeout.id, reason: timeout.endReason });
    });
  }

  cancelTimeout(reason) {
    const correctionReason = validName(reason, 'Timeout cancellation reason', 300);
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      const timeout = this._activeTimeout(match);
      if (!timeout) throw fail('NO_ACTIVE_TIMEOUT', 'There is no timeout to cancel.');
      timeout.status = 'CANCELLED';
      timeout.cancelledAt = this.now();
      timeout.correctionReason = correctionReason;
      this._syncTimeoutRecord(match, timeout);
      match.activeTimeout = null;
      this._appendAction(match, 'TIMEOUT_CANCELLED', { timeoutId: timeout.id, reason: correctionReason });
    });
  }

  resolveTimeoutRecovery(choice, reason = '') {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      const timeout = match.activeTimeout;
      if (!timeout || timeout.status !== 'RECOVERY_REVIEW') throw fail('NO_TIMEOUT_RECOVERY', 'There is no interrupted timeout to resolve.');
      if (!['resume', 'end', 'cancel'].includes(choice)) throw fail('INVALID_RECOVERY_CHOICE', 'Choose resume, end, or cancel.');
      if (choice !== 'resume' && Array.from(String(reason).trim()).length < 5) {
        throw fail('CORRECTION_REASON_REQUIRED', 'Enter a reason of at least 5 characters.');
      }
      if (choice === 'resume') {
        timeout.status = timeout.remainingAtRecovery > 0 ? 'ACTIVE' : 'TIMER_ELAPSED_AWAITING_OPERATOR';
        timeout.deadlineAt = this.now() + timeout.remainingAtRecovery * 1000;
        timeout.timerElapsedAt = timeout.remainingAtRecovery > 0 ? null : this.now();
        timeout.resumedAt = this.now();
      } else {
        timeout.status = choice === 'end' ? 'ENDED' : 'CANCELLED';
        timeout.endedAt = this.now();
        timeout.recoveryReason = String(reason).trim();
        match.activeTimeout = null;
      }
      this._syncTimeoutRecord(match, timeout);
      this._appendAction(match, 'TIMEOUT_RECOVERY_RESOLVED', { timeoutId: timeout.id, choice, reason: String(reason).trim() });
    });
  }

  _checkTimeout() {
    const match = this.data.activeMatch;
    const timeout = match && match.activeTimeout;
    if (!timeout || timeout.status !== 'ACTIVE' || timeout.deadlineAt > this.now()) return false;
    try {
      this._commit((candidate) => {
        const active = this._requireMatch(candidate).activeTimeout;
        if (!active || active.status !== 'ACTIVE') return;
        active.status = 'TIMER_ELAPSED_AWAITING_OPERATOR';
        active.timerElapsedAt = this.now();
        this._syncTimeoutRecord(candidate.activeMatch, active);
        this._appendAction(candidate.activeMatch, 'TIMEOUT_TIMER_ELAPSED', { timeoutId: active.id });
      });
      return true;
    } catch (error) {
      console.error('[Volleyball] Could not persist timeout expiration:', error.message);
      return false;
    }
  }

  _syncTimer() {
    const match = this.data.activeMatch;
    const timeout = match && match.activeTimeout;
    if (this.recoveryPersistenceError || !timeout || timeout.status !== 'ACTIVE') {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.lastPublishedRemaining = null;
      return;
    }
    if (this.timer) return;
    this.lastPublishedRemaining = Math.max(0, Math.ceil((timeout.deadlineAt - this.now()) / 1000));
    this.timer = setInterval(() => {
      if (this._checkTimeout()) return;
      const activeMatch = this.data.activeMatch;
      const current = activeMatch && activeMatch.activeTimeout;
      if (!current || current.status !== 'ACTIVE') return;
      const remaining = Math.max(0, Math.ceil((current.deadlineAt - this.now()) / 1000));
      if (remaining !== this.lastPublishedRemaining) {
        this.lastPublishedRemaining = remaining;
        this._publish('changed');
      }
    }, 250);
    this.timer.unref?.();
  }

  switchSides(options = {}) {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      if (match.status === 'MATCH_COMPLETE') throw fail('MATCH_COMPLETE', 'Reopen the match through the correction flow before changing sides.');
      if (options.confirmed !== true) throw fail('CONFIRMATION_REQUIRED', 'Confirm the court-side switch.');
      const before = clone(match.courtSides);
      [match.courtSides.leftTeamId, match.courtSides.rightTeamId] = [match.courtSides.rightTeamId, match.courtSides.leftTeamId];
      this._appendAction(match, 'COURT_SIDES_SWITCHED', { before, after: clone(match.courtSides), reason: options.reason || 'Operator switch' });
    });
  }

  resolveSideSwitchPrompt(action, options = {}) {
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      const prompt = match.pendingSideSwitchPrompt;
      if (!prompt) throw fail('NO_SIDE_PROMPT', 'There is no side-switch prompt awaiting a decision.');
      if (!['switch', 'dismiss', 'defer'].includes(action)) throw fail('INVALID_SIDE_ACTION', 'Choose switch, dismiss, or defer.');
      const wasDeferred = prompt.status === 'DEFERRED';
      const before = clone(match.courtSides);
      if (action === 'switch') {
        if (options.confirmed !== true) throw fail('CONFIRMATION_REQUIRED', 'Confirm the court-side switch.');
        [match.courtSides.leftTeamId, match.courtSides.rightTeamId] = [match.courtSides.rightTeamId, match.courtSides.leftTeamId];
      }
      if (action === 'defer') {
        prompt.status = 'DEFERRED';
        match.status = prompt.resumeStatus;
      } else {
        match.resolvedSidePromptKeys.push(prompt.key);
        match.pendingSideSwitchPrompt = null;
        if (!wasDeferred) match.status = prompt.resumeStatus;
      }
      this._appendAction(match, 'SIDE_SWITCH_PROMPT_RESOLVED', {
        promptId: prompt.id,
        promptKey: prompt.key,
        action,
        reason: String(options.reason || '').trim(),
        before,
        after: clone(match.courtSides),
        sideAssignment: clone(match.courtSides)
      });
    });
  }

  undoLastSideSwitch(reason) {
    const correctionReason = validName(reason, 'Side-switch correction reason', 300);
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      const last = match.actionHistory[match.actionHistory.length - 1];
      const isPromptSwitch = last && last.type === 'SIDE_SWITCH_PROMPT_RESOLVED' && last.action === 'switch';
      if (!last || !['COURT_SIDES_SWITCHED', 'SIDE_SWITCH_PROMPT_RESOLVED'].includes(last.type) || (last.type === 'SIDE_SWITCH_PROMPT_RESOLVED' && !isPromptSwitch) || last.undoneBy) {
        throw fail('UNDO_NOT_AVAILABLE', 'Only the most recent manual side switch can be undone.');
      }
      match.courtSides = clone(last.before);
      last.undoneBy = this.makeId();
      this._appendAction(match, 'COURT_SIDES_SWITCH_UNDONE', { targetActionId: last.id, reason: correctionReason });
    });
  }

  setAnnouncementLive(text, requestId) {
    const announcementText = typeof text === 'string' ? text : '';
    if (!announcementText.trim()) throw fail('EMPTY_ANNOUNCEMENT', 'Enter announcement text before taking it live.');
    const id = String(requestId || '').trim();
    if (!id || id.length > 120) throw fail('INVALID_ANNOUNCEMENT_REQUEST', 'A valid announcement request ID is required.');
    return this._commit((candidate) => {
      const match = this._requireAnnouncementRecord(candidate);
      const length = Array.from(announcementText).length;
      if (length > match.rules.announcementMaxChars) {
        throw fail('ANNOUNCEMENT_TOO_LONG', `Announcement must be ${match.rules.announcementMaxChars} characters or fewer.`, {
          limit: match.rules.announcementMaxChars,
          actual: length
        });
      }
      if (match.announcement.lastRequestId === id) return;
      if (match.announcement.live && match.announcement.live.text === announcementText) {
        match.announcement.lastRequestId = id;
        return;
      }
      match.announcement.revision++;
      match.announcement.lastRequestId = id;
      match.announcement.live = {
        id: this.makeId(),
        text: announcementText,
        revision: match.announcement.revision,
        publishedAt: this.now()
      };
      this._appendAction(match, 'ANNOUNCEMENT_TAKEN_LIVE', {
        announcementId: match.announcement.live.id,
        revision: match.announcement.revision,
        characterCount: length
      });
    });
  }

  clearAnnouncement(expectedId) {
    return this._commit((candidate) => {
      const match = this._requireAnnouncementRecord(candidate);
      const live = match.announcement.live;
      if (!live) return;
      if (expectedId && expectedId !== live.id) throw fail('STALE_ANNOUNCEMENT', 'The live announcement changed; refresh before clearing.');
      match.announcement.revision++;
      match.announcement.live = null;
      this._appendAction(match, 'ANNOUNCEMENT_CLEARED', { announcementId: live.id, revision: match.announcement.revision });
    });
  }

  reopenCompletedMatch(matchId, options = {}) {
    const reason = validName(options.reason, 'Correction reason', 300);
    if (options.confirmed !== true) throw fail('CONFIRMATION_REQUIRED', 'Confirm reopening the completed match for correction.');
    return this._commit((candidate) => {
      if (candidate.activeMatch) throw fail('ACTIVE_MATCH_EXISTS', 'Resolve the active match before reopening a result.');
      const result = candidate.completedResults.find((entry) => entry.id === matchId && !entry.supersededBy);
      if (!result) throw fail('RESULT_NOT_FOUND', 'The completed result was not found.');
      const match = clone(result);
      const originalMatchId = result.matchId || result.id;
      match.id = this.makeId();
      match.matchId = originalMatchId;
      match.correctionOf = result.id;
      match.resultRevision = (result.resultRevision || 1) + 1;
      match.status = 'CORRECTION_REVIEW';
      match.completedAt = null;
      match.winnerTeamId = null;
      match.pendingSideSwitchPrompt = null;
      match.activeTimeout = null;
      result.supersededBy = match.id;
      result.supersededAt = this.now();
      this._appendAction(match, 'COMPLETED_MATCH_REOPENED', { sourceResultId: result.id, reason });
      candidate.activeMatch = match;
    });
  }

  correctSetScore(setNumber, points, options = {}) {
    const reason = validName(options.reason, 'Correction reason', 300);
    if (options.confirmed !== true) throw fail('CONFIRMATION_REQUIRED', 'Confirm the set-score correction.');
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      this._requireStatus(match, 'CORRECTION_REVIEW');
      const set = match.sets.find((entry) => entry.number === setNumber);
      if (!set || !['COMPLETE', 'CORRECTION_REVIEW'].includes(set.status)) throw fail('INVALID_SET', 'Select a completed set in correction review.');
      this._validatePoints(points, match);
      const before = clone(set.points);
      set.points = { [match.homeTeamId]: points[match.homeTeamId], [match.awayTeamId]: points[match.awayTeamId] };
      const winnerTeamId = this._isSetWinner(match, set);
      set.winnerTeamId = winnerTeamId;
      set.status = winnerTeamId ? 'COMPLETE' : 'CORRECTION_REVIEW';
      set.correctionReason = reason;
      set.correctedAt = this.now();
      this._appendAction(match, 'COMPLETED_SET_SCORE_CORRECTED', {
        setNumber,
        before,
        after: clone(set.points),
        winnerTeamId,
        reason
      });
      const setsWon = this._setsWon(match);
      const winner = Object.entries(setsWon).find(([, count]) => count >= match.setsToWin)?.[0] || null;
      match.winnerTeamId = winner;
      match.finalSetsWon = setsWon;
      if (winner) {
        match.status = 'CORRECTION_READY_TO_FINALIZE';
      } else {
        match.currentSetNumber = setNumber;
        match.status = 'CORRECTION_REVIEW';
      }
    });
  }

  _validatePoints(points, match) {
    if (!points || typeof points !== 'object') throw fail('INVALID_SCORE', 'Set points are required.');
    for (const teamId of [match.homeTeamId, match.awayTeamId]) {
      if (!Number.isInteger(points[teamId]) || points[teamId] < 0 || points[teamId] > 200) {
        throw fail('INVALID_SCORE', 'Corrected set points must be whole numbers from 0 to 200.');
      }
    }
  }

  finalizeCorrection(options = {}) {
    const reason = validName(options.reason, 'Correction reason', 300);
    if (options.confirmed !== true) throw fail('CONFIRMATION_REQUIRED', 'Confirm finalizing the corrected result.');
    return this._commit((candidate) => {
      const match = this._requireMatch(candidate);
      this._requireStatus(match, 'CORRECTION_READY_TO_FINALIZE');
      const winnerTeamId = match.winnerTeamId;
      if (!winnerTeamId) throw fail('INVALID_CORRECTION', 'The corrected match does not have a valid winner.');
      const prior = candidate.completedResults.find((entry) => entry.id === match.correctionOf);
      if (!prior || prior.supersededBy !== match.id) throw fail('INVALID_CORRECTION', 'The original result revision is unavailable.');
      match.status = 'MATCH_COMPLETE';
      match.completedAt = this.now();
      match.correctionReason = reason;
      this._appendAction(match, 'CORRECTED_RESULT_FINALIZED', { winnerTeamId, reason });
      const result = clone(match);
      result.matchId = match.matchId || match.id;
      const limit = match.rules.completedResultLimit;
      const overLimit = limit > 0 && candidate.completedResults.length >= limit;
      if (overLimit && options.confirmRetention !== true) {
        throw fail('RESULT_RETENTION_CONFIRMATION_REQUIRED', 'Finalizing this revision will remove the oldest result under the configured retention limit.');
      }
      if (overLimit) candidate.completedResults.shift();
      candidate.completedResults.push(result);
      candidate.activeMatch = null;
    });
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

VolleyballEngine.DEFAULT_RULES = DEFAULT_RULES;
VolleyballEngine.validateRules = validateRules;
module.exports = VolleyballEngine;
