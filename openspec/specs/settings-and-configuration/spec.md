# Settings and Configuration Specification

## Purpose
YodaMan keeps the user's settings and workspace list in `config.json` inside a per-user data folder. This capability covers where that folder is (`backend/infrastructure/DataPaths.js`), the settings store with its defaults and environment overrides (`SettingsProvider.js`), the Ollama context window control (`OllamaConfig.js`), the routes `GET/PUT /api/settings`, `GET/POST /api/ctx/config` and `GET/POST /api/ollama/context` in `backend/interfaces/RestController.js`, `config.example.json`, and the Settings window (`src/components/SettingsModal.jsx`, `EditorSettings.jsx`). Models are local Ollama models only.

## Requirements

### Requirement: Data folder
YodaMan SHALL keep `config.json` and `yodaman.db` in a per-user data folder outside the install folder. `YODAMAN_DATA_DIR` SHALL move the folder, and `YODAMAN_CONFIG_PATH` and `YODAMAN_DB_PATH` SHALL each point one file elsewhere.

#### Scenario: Default location
- **WHEN** no data variable is set
- **THEN** the folder is `~/Library/Application Support/YodaMan` on macOS, `%APPDATA%\YodaMan` on Windows, and `$XDG_CONFIG_HOME/YodaMan` (else `~/.config/YodaMan`) on Linux

#### Scenario: Other state files
- **WHEN** a module needs another state file such as `sessions.json` or `audit-log.jsonl`
- **THEN** `dataFile(name)` places it in the data folder, even when `YODAMAN_CONFIG_PATH` points elsewhere

#### Scenario: Dashboard view
- **WHEN** `describeDataFiles()` is called
- **THEN** it returns `dataDir`, and `config` and `database` each as `{ path, exists, bytes, modifiedAt }`

### Requirement: Data from an older install
`prepareDataDir()` SHALL create the data folder and copy `config.json`, `yodaman.db` and `sessions.json` from the install folder once, only when the data folder lacks that file. It MUST copy, never move, and MUST NOT overwrite an existing file. It SHALL run once per process and destination.

#### Scenario: Database copy
- **WHEN** `yodaman.db` is copied
- **THEN** it is copied with SQLite `VACUUM INTO`, so rows still in the write-ahead log are kept

#### Scenario: Copy fails
- **WHEN** a copy throws
- **THEN** the file is listed in `failed` with the error, the old copy is untouched, and `server.js` logs `data_migration_failed`

### Requirement: config.json layout
`config.json` SHALL hold `watchedDirectories` (array), `removedDirectories` (array) and a `settings` object. `config.example.json` SHALL show these keys with the secure defaults.

#### Scenario: Example file
- **WHEN** `config.example.json` is read
- **THEN** it has empty `watchedDirectories` and `removedDirectories`, and `settings` with `requirePairingToken: true`, `allowAgentCommands: false`, `allowPluginUploads: false`, `allowUnrestrictedPlugins: false`, `allowSelfHealInstall: false` and `allowedCommands: []`

#### Scenario: Unreadable config at startup
- **WHEN** `config.json` cannot be parsed
- **THEN** startup records `config` as `ok: false` with `config load failed: <reason>` and keeps running

### Requirement: Setting defaults
`SettingsProvider.DEFAULTS` SHALL be: `allowPluginUploads` false, `allowUnrestrictedPlugins` false, `allowAgentCommands` false, `requirePairingToken` true, `allowSelfHealInstall` false, `allowedCommands` `[]`, and `editorCommand` `""`. Values in `config.json` `settings` SHALL override the defaults.

#### Scenario: No file
- **WHEN** `config.json` does not exist
- **THEN** every setting has its default

#### Scenario: Malformed file
- **WHEN** `config.json` is not valid JSON
- **THEN** every setting falls back to its default and `settings_unreadable_using_defaults` is logged with severity `high`

#### Scenario: Unknown key
- **WHEN** `get(key)` is called for a key with no value
- **THEN** it returns `null`

### Requirement: Environment overrides
Every setting SHALL be overridable by `YODAMAN_` plus its name in upper snake case. The override SHALL win over `config.json` in both enforcement (`get`) and reporting (`getAll`), and SHALL never be written to `config.json`.

#### Scenario: Variable names
- **WHEN** the names are derived
- **THEN** they are `YODAMAN_ALLOW_PLUGIN_UPLOADS`, `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS`, `YODAMAN_ALLOW_AGENT_COMMANDS`, `YODAMAN_REQUIRE_PAIRING_TOKEN`, `YODAMAN_ALLOW_SELF_HEAL_INSTALL`, `YODAMAN_ALLOWED_COMMANDS` and `YODAMAN_EDITOR_COMMAND`

#### Scenario: Value parsing
- **WHEN** a variable is `true` or `false`
- **THEN** it becomes a boolean
- **AND** `YODAMAN_ALLOWED_COMMANDS=git,make` becomes `["git","make"]`; any other value is used as the raw string

### Requirement: Setting drift at startup
`drift()` SHALL list every setting whose effective value differs from its default, with `key`, `value`, `expected` and `source`. At startup `server.js` SHALL log one `security_setting_non_default` warning per item.

#### Scenario: Turned on by environment
- **WHEN** `YODAMAN_ALLOW_AGENT_COMMANDS=true` is set
- **THEN** the drift item has `source: "YODAMAN_ALLOW_AGENT_COMMANDS"`; a value from the file has `source: "config.json"`

### Requirement: GET /api/settings
`GET /api/settings` SHALL return every setting with environment overrides applied, as one flat JSON object.

#### Scenario: Override shown
- **WHEN** `config.json` has `allowAgentCommands: false` and `YODAMAN_ALLOW_AGENT_COMMANDS=true` is set
- **THEN** the response shows `allowAgentCommands: true`

### Requirement: PUT /api/settings
`PUT /api/settings` MUST only be accepted from this computer. It SHALL accept the five boolean switches, `allowedCommands` and `editorCommand`, ignore other keys, save the merged settings into `config.json`, reload plugin permissions, and return all settings. When `config.json` cannot be written the answer MUST be 500 code `settings_save_failed` and the change MUST NOT take effect.

#### Scenario: Not this computer
- **WHEN** the request does not come from loopback
- **THEN** the answer is 403 code `settings_local_only`, `Settings can only be changed from this computer`

#### Scenario: Switches
- **WHEN** the body sets `allowPluginUploads`, `allowUnrestrictedPlugins`, `allowAgentCommands`, `requirePairingToken` or `allowSelfHealInstall`
- **THEN** each value is stored as `Boolean(value)`

#### Scenario: Extra commands
- **WHEN** `allowedCommands` is not an array
- **THEN** the answer is 400 code `invalid_settings`, `allowedCommands must be an array of executable names`
- **AND** an entry not matching `^[a-zA-Z0-9._-]+$` gives 400 `Invalid executable names: <entries>`

#### Scenario: Editor and empty body
- **WHEN** `editorCommand` is `system`, or another value, or the body has no accepted key
- **THEN** `system` is stored as `""`; another value is trimmed after the editor validator passes, and a validator message gives 400 code `invalid_settings`
- **AND** a body with no accepted key gives 400 code `invalid_settings`, `No valid settings provided`

### Requirement: Context Expert configuration
`GET /api/ctx/config` SHALL return `ctx config list --json` as `{ ok: true, config }`. `POST /api/ctx/config` MUST only be accepted from this computer and SHALL run `ctx config set <key> <value>` without a shell. Failures from ctx SHALL be reported as status 200 with `{ ok: false, error }`.

#### Scenario: Missing fields
- **WHEN** the POST body lacks `key` or `value`
- **THEN** the answer is 400 `{ ok: false, error: "key and value are required" }`

#### Scenario: Saved
- **WHEN** ctx accepts the value
- **THEN** the answer is `{ ok: true, key, value }`, with `value` passed to ctx as a string

#### Scenario: Dashboard panel
- **WHEN** the Dashboard shows the ctx Configuration panel
- **THEN** it lists `default_model`, `default_provider`, embedding, search, observability and evaluation keys, and a click edits one value through `POST /api/ctx/config`

### Requirement: Ollama context window
`GET /api/ollama/context` SHALL report how Ollama is managed. `POST /api/ollama/context` MUST only be accepted from this computer, SHALL accept only `tokens` of 8192, 16384, 32768, 65536 or 131072, and SHALL only change the Homebrew plist `~/Library/LaunchAgents/homebrew.mxcl.ollama.plist`.

#### Scenario: Inspect
- **WHEN** `GET /api/ollama/context` is called
- **THEN** it returns `{ managed, manager, plistPath, configured, recommended: 32768, allowed }`, with `manager` `brew` or `unknown`
- **AND** `configured` comes from the runtime's `OLLAMA_CONTEXT_LENGTH`, else from the plist

#### Scenario: Value not allowed
- **WHEN** `tokens` is 4096
- **THEN** the answer is 400 code `ollama_context_set_failed`, `Context length must be one of: 8192, 16384, 32768, 65536, 131072`

#### Scenario: Not managed by Homebrew
- **WHEN** the plist does not exist
- **THEN** the answer is 409 with a message telling the user to set `OLLAMA_CONTEXT_LENGTH=<tokens>` where Ollama runs and restart it

#### Scenario: Dashboard offers the fix only when it can apply it
- **WHEN** `/api/health` reports a small `contextWindow`
- **THEN** the Dashboard shows **Set 32,768 & restart Ollama** only when `contextWindow.managed` is true
- **AND** otherwise it says to set `OLLAMA_CONTEXT_LENGTH=32768` where Ollama runs, then restart it

#### Scenario: Apply and roll back
- **WHEN** a valid value is applied
- **THEN** the plist is backed up to `<plist>.yodaman-backup`, updated, checked with `plutil -lint`, and Ollama restarted with `brew services restart ollama`, answering `{ ok: true, applied, restarted: true, backupPath }`
- **AND** if the check or restart fails the original plist is written back and the answer is 500 `Could not apply the change, so it was rolled back: <reason>`

### Requirement: Settings window
The Settings window SHALL show workspace controls, an editor picker, a Developer Settings section with five switches, and MCP client snippets. Each switch SHALL show the saved value from `GET /api/settings` and stay disabled until it has loaded.

#### Scenario: Toggle a switch
- **WHEN** the user toggles a switch
- **THEN** it changes at once and calls `PUT /api/settings` with that one key
- **AND** if the save fails the switch goes back to its previous value

#### Scenario: Switch labels
- **WHEN** Developer Settings is opened
- **THEN** the switches read `Plugin Uploads`, `Unrestricted Plugins`, `Agent Shell Commands`, `Repair Can Install Missing Tools` and `Require Pairing Token`, in that order

#### Scenario: Editor picker
- **WHEN** the user picks `System default`, a detected editor, or saves a `Custom command…` template using `{file}`, `{line}` and `{column}`
- **THEN** the choice is saved with `PUT /api/settings` as `editorCommand` (`system` for the default) and `Saved` is shown briefly

#### Scenario: Closing
- **WHEN** the user presses Escape, clicks outside the dialog or presses `DISMISS`
- **THEN** the window closes
