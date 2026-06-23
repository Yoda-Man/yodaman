/**
 * SettingsProvider — centralized settings store backed by config.json
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  allowPluginUploads: false,
  allowUnrestrictedPlugins: false,
  allowAgentCommands: false,
  requirePairingToken: true
};

let cache = null;
let loadedPath = null;

function configPath() {
  return process.env.YODAMAN_CONFIG_PATH || path.join(__dirname, '../../config.json');
}

function load() {
  const currentPath = configPath();
  if (cache && loadedPath === currentPath) return cache;

  try {
    if (fs.existsSync(currentPath)) {
      const raw = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
      cache = { ...DEFAULTS, ...raw.settings };
    } else {
      cache = { ...DEFAULTS };
    }
  } catch {
    cache = { ...DEFAULTS };
  }

  loadedPath = currentPath;
  return cache;
}

function save(updates) {
  const currentPath = configPath();
  const settings = { ...load(), ...updates };
  cache = settings;
  loadedPath = currentPath;

  try {
    let cfg = {};
    if (fs.existsSync(currentPath)) cfg = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
    cfg.settings = settings;
    fs.writeFileSync(currentPath, JSON.stringify(cfg, null, 2));
  } catch (error) {
    console.error('[Settings]', error.message);
  }
}

function get(key) {
  const envKey = 'YODAMAN_' + key.replace(/([A-Z])/g, '_$1').toUpperCase();
  const envValue = process.env[envKey];
  if (envValue !== undefined) return envValue === 'true' ? true : envValue === 'false' ? false : envValue;

  const settings = load();
  return settings[key] !== undefined ? settings[key] : null;
}

function getAll() {
  return { ...load() };
}

function reset() {
  cache = null;
  loadedPath = null;
}

module.exports = { get, getAll, save, load, reset, configPath };
