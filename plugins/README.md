# YodaMan Plugin API Reference

A plugin is a CommonJS `.js` file in `plugins/`. At start-up the runtime
`require()`s every `.js` file directly in this folder (not in subfolders) and
offers each valid one to the agent as a tool (`backend/infrastructure/ToolBox.js`).

## The contract

| Export | Required | Notes |
| --- | --- | --- |
| `name` | yes | A string. The tool name the agent calls. |
| `execute(parameters)` | yes | An async function returning the result. A file that exports `onLoad` or `onEnable` instead is wrapped as a legacy plugin. |
| `permissions` | for uploads | An array of strings. A plugin with no permissions, or an empty list, is treated as `unrestricted`, which does not run unless **Unrestricted Plugins** is on in Settings. |
| `description`, `parameters` | no | Shown to the model in the tool list. |

Permissions must come from this list, or the plugin is rejected: `read`,
`write`, `command`, `network`, `search`, `unrestricted`, `graphify:read`,
`agent:invoke`, `audit:write`, `task:create`, `desktop:openFile`,
`storage:indexeddb`, `webxr`, `speech`, `git:read`, `upload:temp`,
`filesystem:read-selected`.

A plugin that declares `write`, `unrestricted`, `command`, `audit:write`,
`agent:invoke` or `task:create` pauses for your approval every time the agent
calls it (`shared/toolCapabilities.js`).

Permissions are declarative. A plugin runs inside the runtime with full Node.js
access, so a permission says what the plugin intends and drives the approval
gate; it is not a sandbox. Install only plugins you trust. The plugin API
enforces one permission itself: `api.fetch` to another host works only for a
plugin that declares `network` or `unrestricted`. A path such as
`/api/graphify/status` calls the local YodaMan runtime and needs no permission.

## Adding a plugin

`yodaman create-plugin <name>` writes `plugins/<name>.js`, a test beside it, and
an entry in this file to fill in. The name must start with a letter and hold
only letters, digits, `-` and `_`, at most 64 characters.

Uploading a plugin from the app is off by default. Turn on **Plugin Uploads** in
Settings, or set `YODAMAN_ALLOW_PLUGIN_UPLOADS=true`. An upload is a `.js` file
or a `.zip`; from a zip, `main.js` is used if present, otherwise the first `.js`
file, and it is installed as `<archive name>.js`. A `permissions` array in a
`plugin.json` inside the zip is applied. Uploads must declare `permissions`. An
upload may not replace an installed plugin, by file name or by plugin name;
delete the old one first.

Disabling a plugin keeps its file. The list of disabled plugins is kept in
`plugins.json` in the YodaMan data folder, so it survives upgrades. A disabled
plugin can still be deleted.

## Bundled plugins

The first five are defaults and cannot be removed or disabled.

| Plugin | File | Permissions |
| --- | --- | --- |
| `graphify` | `plugins/graphify.js` | `read`, `search` |
| `Grand-Inquisitor` | `plugins/Grand-Inquisitor.js` | `read` |
| `CodeTrooper` | `plugins/CodeTrooper.js` | `read` |
| `Droid-Sweep` | `plugins/Droid-Sweep.js` | `read` |
| `lightsaber` | `plugins/lightsaber.js` | `read`, `search` |
| `holocron-vr` | `plugins/main.js` (manifest `plugins/plugin.json`) | see `plugin.json` |
