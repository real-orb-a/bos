const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class PackageManager extends EventEmitter {
  constructor(configManager) {
    super();
    this.config = configManager;
    this.packagesDir = path.resolve(__dirname, '..', '..', 'packages');
    this.activePackageName = this.config.get('graphics.activePackage') || 'ssl_media_2026';
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.packagesDir)) {
      fs.mkdirSync(this.packagesDir, { recursive: true });
    }
  }

  listPackages() {
    this._ensureDir();
    const result = [
      {
        name: 'default',
        displayName: 'SLC Default Broadcast Package',
        description: 'Standard built-in television broadcast graphics & transitions',
        path: path.resolve(__dirname, '..', '..', 'graphics'),
        isBuiltIn: true
      }
    ];

    try {
      const entries = fs.readdirSync(this.packagesDir);
      for (const entry of entries) {
        const pkgPath = path.join(this.packagesDir, entry);
        if (fs.statSync(pkgPath).isDirectory()) {
          const manifestPath = path.join(pkgPath, 'package.json');
          let manifest = {};
          if (fs.existsSync(manifestPath)) {
            try {
              manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            } catch (e) {
              console.warn(`[PackageManager] Failed to read ${manifestPath}:`, e.message);
            }
          }
          result.push({
            name: entry,
            displayName: manifest.displayName || entry,
            description: manifest.description || 'Custom broadcast animation package',
            path: pkgPath,
            isBuiltIn: false,
            manifest
          });
        }
      }
    } catch (err) {
      console.error('[PackageManager] listPackages error:', err);
    }

    return result;
  }

  setActivePackage(packageName) {
    this.activePackageName = packageName;
    this.config.set('graphics.activePackage', packageName);
    this.emit('packageChanged', packageName);
    console.log(`[PackageManager] Active graphics package set to: ${packageName}`);
    return true;
  }

  resolveGraphicFile(graphicType, requestedFilename = 'index.html') {
    // If a custom package is selected, attempt to resolve from that package first
    if (this.activePackageName && this.activePackageName !== 'default') {
      const pkgPath = path.join(this.packagesDir, this.activePackageName, graphicType, requestedFilename);
      if (fs.existsSync(pkgPath)) {
        return pkgPath;
      }
    }

    // Fallback to built-in graphics/
    const defaultPath = path.resolve(__dirname, '..', '..', 'graphics', graphicType, requestedFilename);
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }

    return null;
  }
}

module.exports = PackageManager;
