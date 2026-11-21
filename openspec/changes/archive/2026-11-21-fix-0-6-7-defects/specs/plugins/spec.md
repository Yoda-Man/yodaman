## MODIFIED Requirements

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

### Requirement: Chat invocation phrase
`shared/pluginInvocation.js` SHALL give the chat composer and the plugin smoke the same phrase for a plugin: the first quoted phrase after `Chat usage:` in its description that starts with `Run`, else the first quoted phrase, else `Run <name>`. `pluginCapability` SHALL label the most consequential declared permission.

#### Scenario: Explicit phrase preferred
- **WHEN** CodeTrooper's description lists `"How many lines of code?"` then `"Run CodeTrooper"`
- **THEN** the phrase is `Run CodeTrooper`

#### Scenario: Capability label
- **WHEN** a plugin declares `audit:write` and `agent:invoke`
- **THEN** the label is `starts agent tasks`, checked in order `unrestricted`, `write` (`writes files`), `command` (`runs commands`), `agent:invoke`, `task:create`, `network` (`network access`)
- **AND** a plugin with only read-style permissions gets `null`

### Requirement: Plugins page
The Plugins page SHALL list the loaded plugins as cards with their permissions and parameter names, offer **Install Plugin** for a `.js` or `.zip`, a refresh button, a delete button on every card except the five defaults (`isDefault`), and a **Docs** view that renders the authoring guide in place with a way back.

#### Scenario: Upload feedback
- **WHEN** an upload fails
- **THEN** the page shows `Upload failed: <error>` for 3 seconds

#### Scenario: Delete confirm
- **WHEN** the user clicks a card's delete button
- **THEN** the page asks `Are you sure you want to remove the '<name>' plugin?` before calling `DELETE /api/plugins/:name`
