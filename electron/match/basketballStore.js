const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, match: null };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class BasketballStore {
  constructor(filePath) {
    if (!filePath || typeof filePath !== 'string') throw new TypeError('A Basketball store file path is required.');
    this.filePath = path.resolve(filePath);
    this.backupPath = `${this.filePath}.bak`;
    this.loadError = null;
    this.writesBlocked = false;
    this.recoveredFromBackup = false;
    this._sessionBackupDone = false;
    this.data = this._load();
  }

  _validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || data.schemaVersion !== SCHEMA_VERSION
      || !Number.isSafeInteger(data.revision) || data.revision < 0
      || (data.match !== null && (typeof data.match !== 'object' || Array.isArray(data.match)))) {
      throw new Error('Basketball store data is invalid.');
    }
    return data;
  }

  _load() {
    if (!fs.existsSync(this.filePath)) {
      if (!fs.existsSync(this.backupPath)) return emptyData();
      try {
        this.recoveredFromBackup = true;
        this._sessionBackupDone = true;
        this.loadError = { message: 'Basketball primary data is missing.', recovered: true, backupPath: this.backupPath };
        return this._validate(JSON.parse(fs.readFileSync(this.backupPath, 'utf8')));
      } catch (error) {
        this.loadError = { message: 'Basketball primary data is missing.', backupError: error.message, recovered: false };
        this.writesBlocked = true;
        console.error('[BasketballStore] Backup recovery failed:', error.message);
        return emptyData();
      }
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && Number.isInteger(parsed.schemaVersion) && parsed.schemaVersion > SCHEMA_VERSION) {
        throw Object.assign(new Error(`Unsupported Basketball store schema version: ${parsed.schemaVersion}`), { code: 'FUTURE_SCHEMA' });
      }
      return this._validate(parsed);
    } catch (error) {
      this.loadError = { message: error.message, preservedPath: null };
      if (error.code === 'FUTURE_SCHEMA') {
        this.writesBlocked = true;
        console.error('[BasketballStore] Future data schema preserved; writes are disabled:', error.message);
        return emptyData();
      }
      const preservedPath = `${this.filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        fs.copyFileSync(this.filePath, preservedPath);
        this.loadError.preservedPath = preservedPath;
      } catch (copyError) {
        this.loadError.backupError = copyError.message;
      }
      try {
        const recovered = this._validate(JSON.parse(fs.readFileSync(this.backupPath, 'utf8')));
        this.recoveredFromBackup = true;
        this._sessionBackupDone = true;
        this.loadError.recovered = true;
        this.loadError.backupPath = this.backupPath;
        return recovered;
      } catch (backupError) {
        this.loadError.backupError = backupError.message;
        this.writesBlocked = true;
        console.error('[BasketballStore] Data recovery failed:', this.loadError.message, backupError.message);
        return emptyData();
      }
    }
  }

  getData() {
    return clone(this.data);
  }

  getStatus() {
    return {
      loadError: this.loadError ? { ...this.loadError } : null,
      writesBlocked: this.writesBlocked,
      recoveredFromBackup: this.recoveredFromBackup
    };
  }

  save(candidate) {
    if (this.writesBlocked) throw new Error('Basketball storage is read-only until its recovery problem is resolved.');
    this._validate(candidate);
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    const backupTemporary = `${this.backupPath}.tmp`;
    let descriptor = null;
    try {
      if (!this._sessionBackupDone && fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, backupTemporary);
        fs.renameSync(backupTemporary, this.backupPath);
        this._sessionBackupDone = true;
      }
      descriptor = fs.openSync(temporary, 'w');
      fs.writeFileSync(descriptor, JSON.stringify(candidate, null, 2), 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, this.filePath);
      if (!this._sessionBackupDone) {
        try {
          fs.copyFileSync(this.filePath, this.backupPath);
          this._sessionBackupDone = true;
        } catch (error) {
          console.warn('[BasketballStore] Initial backup could not be created:', error.message);
        }
      }
      this.data = clone(candidate);
      return true;
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (closeError) {
          console.warn('[BasketballStore] Failed to close temporary snapshot:', closeError.message);
        }
      }
      for (const filename of [temporary, backupTemporary]) {
        try { if (fs.existsSync(filename)) fs.unlinkSync(filename); } catch (cleanupError) {
          console.warn('[BasketballStore] Temporary-file cleanup failed:', cleanupError.message);
        }
      }
      throw error;
    }
  }
}

BasketballStore.SCHEMA_VERSION = SCHEMA_VERSION;
BasketballStore.emptyData = emptyData;
module.exports = BasketballStore;
