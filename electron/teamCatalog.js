const fs = require('fs');
const path = require('path');

const MAX_TEAMS = 16;
const MAX_LOGO_BYTES = 750 * 1024;
const CONFIG_PATH = path.join(__dirname, '..', 'teams.json');
const APP_ROOT = path.resolve(__dirname, '..');

function fail(message) {
  throw new Error(`[TeamCatalog] ${message}`);
}

function loadTeamCatalog(configPath = CONFIG_PATH) {
  let source;
  try {
    source = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`Could not read teams.json: ${error.message}`);
  }
  if (!source || !Array.isArray(source.teams) || source.teams.length < 2 || source.teams.length > MAX_TEAMS) {
    fail(`teams.json must define between 2 and ${MAX_TEAMS} teams.`);
  }

  const ids = new Set();
  const names = new Set();
  const teams = source.teams.map((team, index) => {
    if (!team || typeof team !== 'object' || Array.isArray(team)) fail(`Team ${index + 1} must be an object.`);
    const id = typeof team.id === 'string' ? team.id.trim() : '';
    const name = typeof team.name === 'string' ? team.name.trim() : '';
    const shortName = typeof team.shortName === 'string' ? team.shortName.trim() : '';
    const active = team.active === undefined ? true : team.active;
    if (typeof active !== 'boolean') fail(`Team ${name || index + 1} active must be true or false.`);
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || ids.has(id)) fail(`Team ${index + 1} has an invalid or duplicate id.`);
    if (!name || Array.from(name).length > 60 || names.has(name.toLocaleLowerCase())) {
      fail(`Team ${index + 1} has an empty, duplicate, or overlong name.`);
    }
    if (Array.from(shortName).length > 12) fail(`Team ${name} shortName must be 12 characters or fewer.`);
    if (!/^#[0-9a-f]{6}$/i.test(team.color || '') || !/^#[0-9a-f]{6}$/i.test(team.secondaryColor || '')) {
      fail(`Team ${name} must have valid color and secondaryColor values.`);
    }
    if (typeof team.logo !== 'string' || !team.logo.trim()) fail(`Team ${name} must define a logo path.`);

    const logoPath = path.resolve(APP_ROOT, team.logo);
    if (!logoPath.startsWith(`${APP_ROOT}${path.sep}`)) fail(`Team ${name} logo must be inside the application folder.`);
    const extension = path.extname(logoPath).toLowerCase();
    const mimeType = extension === '.png' ? 'image/png'
      : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
        : extension === '.svg' ? 'image/svg+xml' : null;
    if (!mimeType) fail(`Team ${name} logo must be PNG, JPEG, or SVG.`);
    let image;
    try {
      image = fs.readFileSync(logoPath);
    } catch (error) {
      fail(`Could not read ${team.logo}: ${error.message}`);
    }
    if (!image.length || image.length > MAX_LOGO_BYTES) fail(`Team ${name} logo must be smaller than 750 KB.`);

    ids.add(id);
    names.add(name.toLocaleLowerCase());
    return {
      id,
      name,
      shortName,
      active,
      primaryColor: team.color,
      secondaryColor: team.secondaryColor,
      logo: `data:${mimeType};base64,${image.toString('base64')}`
    };
  });
  const activeTeams = teams.filter(team => team.active);
  if (activeTeams.length < 2) fail('teams.json must have at least 2 active teams.');
  return activeTeams;
}

module.exports = loadTeamCatalog;
