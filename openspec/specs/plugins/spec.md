# Plugins Specification

## Purpose
Plugins are CommonJS files in `plugins/` that the runtime loads as agent tools. `backend/infrastructure/ToolBox.js` loads, validates and runs them and keeps the disabled list in `plugins.json` in the data folder (copied once from the old `plugins/config.json`); `backend/infrastructure/PluginAPI.js` backs lifecycle-style plugins. The routes under `/api/plugins` live in `backend/interfaces/RestController.js`. YodaMan bundles six plugins: `graphify`, `Grand-Inquisitor`, `CodeTrooper`, `Droid-Sweep`, `lightsaber` and `holocron-vr` (`plugins/main.js`, manifest `plugins/plugin.json`). `shared/pluginInvocation.js`, `scripts/plugin-smoke.js` and the Plugins page (`src/components/PluginsWindow.jsx`, `PluginAuthoringGuide.jsx`) build on them.

## Requirements

### Requirement: Plugin discovery
At startup, and on every reload, the ToolBox SHALL `require()` each `.js` file directly inside `plugins/` (not subfolders), skipping files ending in `.test.js`, clearing each file's require cache first. A file that fails to load MUST be logged as `toolbox_plugin_load_failed` and skipped without stopping the others.

#### Scenario: Scaffold test file ignored
- **WHEN** `plugins/foo.test.js` sits beside `plugins/foo.js`
- **THEN** only `foo.js` is loaded as a plugin

#### Scenario: Disabled plugin not loaded
- **WHEN** the first `name: '<x>'` found in a file's source is in the disabled list
- **THEN** the file is not required and `toolbox_plugin_skipped_disabled` is logged

### Requirement: Plugin contract
A plugin SHALL export an object with a string `name` and an async `execute(parameters)`; `description` and `parameters` are optional and shown to the model. A plugin with no `execute` but an `onLoad` or `onEnable` function SHALL be wrapped as a lifecycle plugin. Anything else MUST be rejected.

#### Scenario: Rejections
- **WHEN** a plugin is validated
- **THEN** a non-object fails with `Plugin must export an object`, a missing name with `Plugin name is required`, and a missing execute with `Plugin <name> must export an execute function`

#### Scenario: Lifecycle wrapper
- **WHEN** a lifecycle plugin is executed
- **THEN** a `PluginAPI` for `plugins/` is passed to `onLoad`, then to `onEnable`, `onDisable` or `onUnload` when `_action` is `enable`, `disable` or `unload`
- **AND** the result is `{ legacy: true, name, message: "Legacy plugin loaded with full API" }`

### Requirement: Lifecycle plugin API
`PluginAPI` SHALL give lifecycle plugins `fetch(url, opts)` over Node http or https returning `{ ok, status, json(), text() }`, `log.info|warn|error` prefixed `[Plugin]`, `ui.registerPluginCard`, `ui.openModal`, `ui.registerShortcut`, `ui.unregisterShortcut`, `worker.run`, `worker.terminateAll` and `config.get`. The ui, worker and config members MUST only log or return null.

#### Scenario: Network permission
- **WHEN** a plugin without the `network` or `unrestricted` permission calls `fetch` with a full URL
- **THEN** it throws `Plugin fetch needs the "network" permission`

#### Scenario: Call to the local runtime
- **WHEN** any plugin calls `fetch` with a path such as `/api/graphify/status`
- **THEN** the request goes to `http://127.0.0.1:<YODAMAN_PORT, default 3090><path>` without a permission check

#### Scenario: Stubbed UI
- **WHEN** a lifecycle plugin calls `api.ui.registerPluginCard({ label: "X" })`
- **THEN** `[PluginAPI] Card: X` is logged and no UI is registered

#### Scenario: Config
- **WHEN** a lifecycle plugin calls `api.config.get()`
- **THEN** it receives `null`

### Requirement: Permissions
Permissions SHALL be trimmed, lowercased and de-duplicated. A missing or empty list MUST be treated as `["unrestricted"]`. Each permission MUST be on the allowlist, and an `unrestricted` plugin SHALL run only when the `allowUnrestrictedPlugins` setting is on.

#### Scenario: Allowlist
- **WHEN** a plugin declares a permission outside `read`, `write`, `command`, `network`, `search`, `unrestricted`, `graphify:read`, `agent:invoke`, `audit:write`, `task:create`, `desktop:openfile`, `storage:indexeddb`, `webxr`, `speech`, `git:read`, `upload:temp`, `filesystem:read-selected`
- **THEN** it fails with `Plugin <name> declares unsupported permissions: <list>`

#### Scenario: Unrestricted blocked
- **WHEN** an unrestricted plugin is executed with `allowUnrestrictedPlugins` off
- **THEN** the call fails with `Plugin <name> is unrestricted. Enable in Settings.`

#### Scenario: Approval from declared permissions
- **WHEN** the agent calls a plugin that declares `write`, `unrestricted`, `command`, `audit:write`, `agent:invoke` or `task:create`
- **THEN** the call pauses for approval, and a plugin whose permissions are all read-only does not

### Requirement: List plugins
`GET /api/plugins` SHALL return a JSON array of the loaded plugins, each `{ name, description, parameters, permissions, restricted, isDefault }`, where `restricted` is true unless permissions include `unrestricted` and `isDefault` is true for the five default plugins. Disabled plugins MUST NOT appear.

#### Scenario: Bundled list
- **WHEN** a fresh install calls `GET /api/plugins`
- **THEN** the array holds `CodeTrooper`, `Droid-Sweep`, `Grand-Inquisitor`, `graphify`, `lightsaber` and `holocron-vr`
- **AND** `isDefault` is true for all but `holocron-vr`

### Requirement: Upload a plugin
`POST /api/plugins` SHALL accept one multipart file in field `plugin`, a `.js` or `.zip` whose name matches `^[a-zA-Z0-9_-]+\.(js|zip)$`. It MUST be refused with 403 unless the `allowPluginUploads` setting (env `YODAMAN_ALLOW_PLUGIN_UPLOADS`) is on, and an upload MUST NOT replace an existing plugin file or take an installed plugin's name. A refused file name MUST get 400 code `invalid_plugin`, and a taken file or plugin name 409 code `plugin_exists`, whether the file is a `.js` or a `.zip`.

#### Scenario: Uploads off
- **WHEN** uploads are disabled
- **THEN** the answer is 403 `{ error: "Plugin uploads are disabled. Set YODAMAN_ALLOW_PLUGIN_UPLOADS=true only for trusted local support sessions.", code: "plugin_uploads_disabled" }`

#### Scenario: Accepted upload
- **WHEN** a valid plugin with a `permissions` array is uploaded
- **THEN** it is validated with explicit permissions required, the plugins are reloaded, and the answer is `{ message: "Plugin uploaded and loaded", name: "<file>" }`

#### Scenario: Rejected upload
- **WHEN** the plugin fails validation, for example with no permissions array (`Plugin <name> must declare a permissions array`)
- **THEN** the uploaded and extracted files are removed and the answer is 400 `{ error, code: "invalid_plugin" }`
- **AND** a request with no file gets 400 `{ error: "No file uploaded", code: "no_file" }`

#### Scenario: Name taken
- **WHEN** the upload is named `graphify.js`, or its plugin is named like an installed or disabled one
- **THEN** the answer is 409 code `plugin_exists` and nothing is installed

#### Scenario: Zip archive
- **WHEN** a `.zip` is uploaded
- **THEN** it is extracted with `unzip`, `main.js` is used if present or else the first `.js`, installed as `<archive name>.js` (never over Holocron's `plugins/main.js`), skipping symlinks, `__MACOSX`, dot folders, `._` files and anything deeper than 12 levels
- **AND** a `permissions` array from a `plugin.json` in the archive is written into the plugin source, and an archive with no `.js` fails with `No .js plugin file found in the zip archive`

### Requirement: Delete a plugin
`DELETE /api/plugins/:name` SHALL delete a loaded or disabled plugin's file from `plugins/`, drop it from the loaded set and from the disabled list. The five default plugins `graphify`, `Grand-Inquisitor`, `CodeTrooper`, `Droid-Sweep` and `lightsaber` MUST NOT be deletable.

#### Scenario: Default plugin
- **WHEN** a client deletes `graphify`
- **THEN** the answer is 403 `{ error: "graphify is a default plugin and cannot be removed", code: "mandatory_plugin" }`

#### Scenario: Deleted
- **WHEN** a client deletes a loaded or disabled non-default plugin
- **THEN** its file is removed and the answer is `{ message: "Plugin deleted" }`

#### Scenario: Unknown
- **WHEN** the name is neither loaded nor disabled
- **THEN** the answer is 404 `{ error: "Plugin not found", code: "plugin_not_found" }`

### Requirement: Enable and disable
`POST /api/plugins/:name/disable` SHALL add the name to the disabled list, call the plugin's `onDisable` when it has one, unload it and save `plugins.json` in the data folder as `{ "disabled": [...] }`. `POST /api/plugins/:name/enable` SHALL remove it from that list, save, and reload plugins. The defaults MUST NOT be disabled.

#### Scenario: Disable
- **WHEN** a client disables `holocron-vr`
- **THEN** the answer is `{ message: "Plugin holocron-vr disabled", name, disabled: true }` and the name is written to `plugins.json`

#### Scenario: Default refused
- **WHEN** a client disables `lightsaber`
- **THEN** the answer is 403 with `lightsaber is a default plugin and cannot be disabled` and code `mandatory_plugin`

#### Scenario: Enable
- **WHEN** a client enables a disabled plugin
- **THEN** the answer is `{ message: "Plugin <name> enabled", name, enabled: true }`
- **AND** a name that is neither loaded nor disabled gets 404 `Plugin not found` with code `plugin_not_found`

#### Scenario: Disabled list survives restart
- **WHEN** the runtime starts and `plugins.json` holds `disabled`
- **THEN** those plugins are not loaded

### Requirement: Plugin status
`GET /api/plugins/:name/status` SHALL answer `{ name, loaded, enabled, disabled }` for any name, with status 200 even when the plugin is unknown.

#### Scenario: Unknown name
- **WHEN** a client asks for the status of `nope`
- **THEN** the answer is `{ name: "nope", loaded: false, enabled: true, disabled: false }`

### Requirement: Open a plugin viewer
`POST /api/plugins/:name/open` SHALL call the plugin's `execute({ _action: "open", project })` with `project` from the body and MUST succeed only when the result has `opened` true.

#### Scenario: Opened
- **WHEN** `holocron-vr` is opened with `{ project }`
- **THEN** the answer is `{ ok: true, name, project, result }` with `result.opened` true and `renderer: "yodaman-host"`

#### Scenario: Not a viewer
- **WHEN** the plugin's result has no `opened`
- **THEN** the answer is 501 with `Plugin completed without opening a viewer. The installed plugin does not implement the open action.` and code `plugin_open_not_implemented`

#### Scenario: Missing or failing
- **WHEN** the plugin is not loaded or is disabled
- **THEN** the answer is 404 `Plugin not found or disabled` with code `plugin_not_found`
- **AND** a plugin that throws gives 500 with code `plugin_open_failed`

### Requirement: Bundled analysis plugins
`CodeTrooper`, `Grand-Inquisitor` and `Droid-Sweep` SHALL declare only `read` and take a `workspacePath`. CodeTrooper SHALL count non-blank lines and files per language. Grand-Inquisitor SHALL report dependencies from package.json, else requirements.txt. Droid-Sweep SHALL find unused files from the knowledge graph, falling back to a text scan.

#### Scenario: CodeTrooper result
- **WHEN** CodeTrooper runs on a workspace
- **THEN** it returns `{ workspace, totalFiles, totalLines, languages }`, skipping `node_modules,dist,build,.git,.next,.venv,release,graphify-out,coverage,downloads` unless `excludeDirs` is given, at most 10 folders deep

#### Scenario: Grand-Inquisitor with neither manifest
- **WHEN** the workspace has no package.json and no requirements.txt
- **THEN** it returns `{ error: "No package.json or requirements.txt found in the specified workspace." }`

#### Scenario: Droid-Sweep method
- **WHEN** a graph exists for the workspace
- **THEN** it returns `method: "knowledge-graph"`, `confidence: "high"` and up to 50 `unusedFiles` with `stillImports`
- **AND** without a graph it returns `method: "text-scan-fallback"` and `confidence: "low"`

### Requirement: Graphify and lightsaber plugins
The `graphify` plugin SHALL declare `read` and `search` and run one Graphify action on a workspace. The `lightsaber` plugin SHALL declare `read` and `search` and analyse Git history through `backend/services/gitService.js` and the knowledge graph.

#### Scenario: graphify actions
- **WHEN** graphify runs with `action` `status`, `build`, `query`, `explain`, `path` or `affected`
- **THEN** it calls the matching GraphifyService method on `path` or `workspacePath`, and with no action it runs `query` when `query` is given and `status` otherwise
- **AND** missing inputs fail with `node is required for graphify explain`, `source and target are required for graphify path` or `query is required for graphify query`

#### Scenario: lightsaber actions
- **WHEN** lightsaber runs with `action` `analyze`, `find-hotspots`, `find-todos`, `test-coverage`, `coupling` or `report`
- **THEN** it returns that analysis, and an unknown action fails with `Unknown action: <a>. Valid actions: analyze, find-hotspots, find-todos, test-coverage, coupling, report`
- **AND** a missing `workspacePath` fails with `workspacePath is required`

### Requirement: Holocron VR plugin
`plugins/main.js` SHALL export plugin `holocron-vr` with the permissions listed in `plugins/plugin.json` and an `execute` that answers `_action` `open`, `enable`, `disable` and `unload`.

#### Scenario: Open accepted
- **WHEN** holocron-vr runs with `{ _action: "open", project }`
- **THEN** it returns `{ opened: true, renderer: "yodaman-host", project, message: "Holocron VR launch accepted by the YodaMan host." }`

### Requirement: Chat invocation phrase
`shared/pluginInvocation.js` SHALL give the chat composer and the plugin smoke the same phrase for a plugin: the first quoted phrase after `Chat usage:` in its description that starts with `Run`, else the first quoted phrase, else `Run <name>`. `pluginCapability` SHALL label the most consequential declared permission.

#### Scenario: Explicit phrase preferred
- **WHEN** CodeTrooper's description lists `"How many lines of code?"` then `"Run CodeTrooper"`
- **THEN** the phrase is `Run CodeTrooper`

#### Scenario: Capability label
- **WHEN** a plugin declares `audit:write` and `agent:invoke`
- **THEN** the label is `starts agent tasks`, checked in order `unrestricted`, `write` (`writes files`), `command` (`runs commands`), `agent:invoke`, `task:create`, `network` (`network access`)
- **AND** a plugin with only read-style permissions gets `null`

### Requirement: Plugin smoke gate
`npm run test:plugins` (`scripts/plugin-smoke.js`) SHALL post each chat-invokable plugin's phrase to `POST /api/agent/task` and MUST fail if the stream contains `response_truncated` or no `"type":"tool_start"` event. It SHALL skip with exit 0 when Ollama at `127.0.0.1:11434` is unreachable.

#### Scenario: Own runtime
- **WHEN** nothing answers on `YODAMAN_SMOKE_URL` (default `http://127.0.0.1:<YODAMAN_SMOKE_PORT or 3098>`)
- **THEN** it starts `server.js` on that port, waits up to 45 seconds for `/api/health`, and stops it afterwards

#### Scenario: Non-chat plugin skipped
- **WHEN** a plugin has no `Chat usage:` and a capability label, like holocron-vr
- **THEN** it is reported as skipped, not failed

#### Scenario: Timeout retried once
- **WHEN** a task times out after `YODAMAN_SMOKE_TASK_TIMEOUT` ms (default 300000)
- **THEN** it is retried once, and if the runtime has gone away the run aborts

### Requirement: Plugins page
The Plugins page SHALL list the loaded plugins as cards with their permissions and parameter names, offer **Install Plugin** for a `.js` or `.zip`, a refresh button, a delete button on every card except the five defaults (`isDefault`), and a **Docs** view that renders the authoring guide in place with a way back.

#### Scenario: Upload feedback
- **WHEN** an upload fails
- **THEN** the page shows `Upload failed: <error>` for 3 seconds

#### Scenario: Delete confirm
- **WHEN** the user clicks a card's delete button
- **THEN** the page asks `Are you sure you want to remove the '<name>' plugin?` before calling `DELETE /api/plugins/:name`
