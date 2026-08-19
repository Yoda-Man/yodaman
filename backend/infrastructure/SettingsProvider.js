/**
 * SettingsProvider — centralized settings store backed by config.json
 */
const fs = require('fs');
const path = require('path');
const logger = require('./Logger');

const DEFAULTS = {
  allowPluginUploads: false,
  allowUnrestrictedPlugins: false,
  allowAgentCommands: false,
  requirePairingToken: true,
  // Installing software is privileged, so POST /api/health/install is opt-in.
  allowSelfHealInstall: false,
  // Extra executables the agent may run, on top of ToolBox's baseline allowlist.
  allowedCommands: []
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
  } catch (err) {
    // Falling back to defaults is right — they are the safe values — but doing
    // it silently is not. A malformed config.json means every setting the user
    // chose is being ignored, security toggles included, and the only symptom
    // is behaviour they did not ask for.
    logger.error('settings_unreadable_using_defaults', err, {
      path: currentPath,
      userAction: 'load_settings',
      severity: 'high',
      hint: 'config.json could not be parsed, so all settings reverted to defaults. '
        + 'Fix the JSON and restart, or delete the file to start from a clean copy.'
    });
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
    logger.error('settings_save_failed', error);
  }
}

/**
 * Environment variable name for a setting.
 * `allowPluginUploads` -> `YODAMAN_ALLOW_PLUGIN_UPLOADS`.
 */
function envKeyFor(key) {
  return 'YODAMAN_' + key.replace(/([A-Z])/g, '_$1').toUpperCase();
}

/**
 * Reads an env override, coercing "true"/"false" to booleans and
 * comma-separated lists to arrays for settings that default to an array.
 * @returns {undefined} when the variable is not set.
 */
function envOverride(key) {
  const raw = process.env[envKeyFor(key)];
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (Array.isArray(DEFAULTS[key])) {
    return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return raw;
}

function get(key) {
  const override = envOverride(key);
  if (override !== undefined) return override;

  const settings = load();
  return settings[key] !== undefined ? settings[key] : null;
}

/**
 * Every setting, with environment overrides applied.
 *
 * The overlay matters: without it GET /api/settings reported the config.json
 * value while enforcement used the environment, so an operator who set
 * YODAMAN_ALLOW_AGENT_COMMANDS=true saw "false" in the UI and in support
 * transcripts while shell commands were in fact enabled.
 */
function getAll() {
  const settings = { ...load() };
  for (const key of Object.keys(DEFAULTS)) {
    const override = envOverride(key);
    if (override !== undefined) settings[key] = override;
  }
  return settings;
}

function reset() {
  cache = null;
  loadedPath = null;
}

/**
 * Security settings that currently differ from their secure default.
 *
 * The August 2026 audit found `allowPluginUploads: true` sitting in the live
 * config with no record of why or when. Nothing surfaced it — it took an audit.
 * Reporting drift at startup makes that class of problem self-announcing, so it
 * lands in runtime.log where support can see it.
 *
 * @returns {Array<{key: string, value: unknown, expected: unknown, source: string}>}
 */
function drift() {
  const effective = getAll();
  return Object.keys(DEFAULTS)
    .filter((key) => JSON.stringify(effective[key]) !== JSON.stringify(DEFAULTS[key]))
    .map((key) => ({
      key,
      value: effective[key],
      expected: DEFAULTS[key],
      source: envOverride(key) !== undefined ? envKeyFor(key) : 'config.json'
    }));
}

module.exports = { get, getAll, save, load, reset, configPath, drift, DEFAULTS };
