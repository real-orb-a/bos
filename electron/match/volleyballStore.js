const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function emptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    activeMatch: null,
    completedResults: []
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class VolleyballStore {
  constructor(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      throw new TypeError('A Volleyball store file path is required.');
    }
    this.filePath = path.resolve(filePath);
    this.backupPath = `${this.filePath}.bak`;
    this.loadError = null;
    this.recoveredFromBackup = false;
    this.writesBlocked = false;
    this._sessionBackupDone = false;
    this.data = this._load();
  }

  _validateEnvelope(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Volleyball store root must be an object.');
    }
    if (data.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`Unsupported Volleyball store schema version: ${data.schemaVersion}`);
    }
    if (!Number.isSafeInteger(data.revision) || data.revision < 0) {
      throw new Error('Volleyball store revision is invalid.');
    }
    if (data.activeMatch !== null && (typeof data.activeMatch !== 'object' || Array.isArray(data.activeMatch))) {
      throw new Error('Volleyball active match must be an object or null.');
    }
    if (!Array.isArray(data.completedResults)) {
      throw new Error('Volleyball completed results must be an array.');
    }
    return data;
  }

  _readAndValidate(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return this._validateEnvelope(parsed);
  }

  _preserveCorruptFile(error) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const preservedPath = `${this.filePath}.corrupt-${stamp}`;
    try {
      fs.copyFileSync(this.filePath, preservedPath);
      return { message: error.message, preservedPath, backupError: null };
    } catch (copyError) {
      return { message: error.message, preservedPath: null, backupError: copyError.message };
    }
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return emptyData();

    try {
      const data = this._readAndValidate(this.filePath);
      return data;
    } catch (primaryError) {
      const preserved = this._preserveCorruptFile(primaryError);
      this.loadError = { ...preserved, recovered: false };

      if (fs.existsSync(this.backupPath)) {
        try {
          const backup = this._readAndValidate(this.backupPath);
          this.recoveredFromBackup = true;
          this._sessionBackupDone = true;
          this.loadError = { ...this.loadError, recovered: true, backupPath: this.backupPath };
          return backup;
        } catch (backupError) {
          this.loadError.backupError = backupError.message;
        }
      }

      this.writesBlocked = true;
      return emptyData();
    }
  }

  getStatus() {
    return {
      loadError: this.loadError ? { ...this.loadError } : null,
      writesBlocked: this.writesBlocked,
      recoveredFromBackup: this.recoveredFromBackup
    };
  }

  getData() {
    return clone(this.data);
  }

  save(candidate) {
    if (this.writesBlocked) {
      throw new Error('Volleyball storage is read-only until its recovery problem is resolved.');
    }
    this._validateEnvelope(candidate);

    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const backupTempPath = `${this.backupPath}.tmp`;
    let descriptor = null;

    try {
      if (!this._sessionBackupDone && fs.existsSync(this.filePath)) {
        const previous = this._readAndValidate(this.filePath);
        fs.copyFileSync(this.filePath, backupTempPath);
        fs.renameSync(backupTempPath, this.backupPath);
        this._sessionBackupDone = true;
      }

      const contents = JSON.stringify(candidate, null, 2);
      descriptor = fs.openSync(tempPath, 'w');
      fs.writeFileSync(descriptor, contents, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(tempPath, this.filePath);

      if (!this._sessionBackupDone) {
        try {
          fs.copyFileSync(this.filePath, this.backupPath);
          this._sessionBackupDone = true;
        } catch (backupError) {
          console.warn('[VolleyballStore] Initial backup could not be created:', backupError.message);
        }
      }

      this.data = clone(candidate);
      return true;
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch {}
      }
      for (const pathToClean of [tempPath, backupTempPath]) {
        try { if (fs.existsSync(pathToClean)) fs.unlinkSync(pathToClean); } catch {}
      }
      throw error;
    }
  }
}

VolleyballStore.SCHEMA_VERSION = SCHEMA_VERSION;
VolleyballStore.emptyData = emptyData;
module.exports = VolleyballStore;
