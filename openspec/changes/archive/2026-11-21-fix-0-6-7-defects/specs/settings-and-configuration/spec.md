## MODIFIED Requirements

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
