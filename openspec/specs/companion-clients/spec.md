# Companion Clients Specification

## Purpose
Companion clients reach the local YodaMan runtime over its HTTP API from outside the desktop window. This capability covers the shared client and protocol in `shared/yodamanClient.js` and `shared/yodamanProtocol.js` (with their `.d.ts` files), the VS Code extension in `extensions/vscode-yodaman` (`package.json`, `src/extension.js`, `src/coreSurface.js`, `copy-shared.js`), the Expo mobile companion in `apps/mobile` (`App.js`, `components.js`, `app.json`, `src/api/yodamanClient.js`), and how these clients authenticate with a pairing token.

## Requirements

### Requirement: Shared client factory
`shared/yodamanClient.js` SHALL export `API_PATHS`, `createYodaManClient(runtimeUrl, options)`, `readEventStream` and `requestJson`. Every request SHALL join the runtime URL, with one trailing slash removed, to an `/api/...` path and send `Content-Type: application/json`.

#### Scenario: Request with a pairing token
- **WHEN** a client is created with `createYodaManClient('http://192.168.1.20:3090/', { pairingToken: 'abc' })` and `status()` is called
- **THEN** it sends `GET http://192.168.1.20:3090/api/status` with headers `Content-Type: application/json` and `X-YodaMan-Token: abc`

#### Scenario: No token
- **WHEN** a client is created without `options.pairingToken`
- **THEN** no `X-YodaMan-Token` header is sent

#### Scenario: Published paths
- **WHEN** a consumer reads `API_PATHS`
- **THEN** it maps `status`, `diagnostics`, `pairing`, `projects`, `ask`, `search`, `reindex`, `approve`, `cancel`, `tasks`, `pendingApprovals`, `policy`, `audit`, `health`, `readiness`, `plugins`, `sessions` and the five `stardust*` keys to `/api/status`, `/api/desktop/diagnostics`, `/api/pairing`, `/api/projects`, `/api/ask`, `/api/search`, `/api/reindex`, `/api/agent/approve`, `/api/agent/cancel`, `/api/agent/tasks`, `/api/agent/pending-approvals`, `/api/policy`, `/api/audit`, `/api/health`, `/api/readiness`, `/api/plugins`, `/api/sessions` and `/api/stardust/{board,drift,compose,context,diagnose}`

### Requirement: Client error messages
`requestJson` SHALL turn a network failure into a runtime-unavailable error and a non-2xx response into an error carrying the server's message, with the HTTP `status` and the body's `code` set on the error. The original network error SHALL be kept as the `cause`.

#### Scenario: Runtime not running
- **WHEN** `fetch` throws `connect ECONNREFUSED` for base URL `http://127.0.0.1:3090`
- **THEN** the error message is `YodaMan runtime is not available at http://127.0.0.1:3090. Start the YodaMan desktop app or run "yodaman" from Terminal, then try again. Details: connect ECONNREFUSED`

#### Scenario: JSON error body
- **WHEN** the runtime answers 401 with `{"error":"Valid YodaMan pairing token is required","code":"pairing_token_required"}`
- **THEN** the thrown message is `Valid YodaMan pairing token is required`

#### Scenario: Unregistered workspace
- **WHEN** a Stardust route answers 404 with `{"error":"Workspace is not registered: <path>","code":"workspace_not_registered"}`
- **THEN** the thrown message is `Workspace is not registered: <path>. Add this folder to YodaMan first, then try again.`, with `status` 404 and `code` `workspace_not_registered`

#### Scenario: Text or empty error body
- **WHEN** the response is not ok and its content type is not JSON
- **THEN** the thrown message is the body text, or `YodaMan request failed with HTTP <status>` when the body is empty

### Requirement: Client method surface
The client object SHALL expose methods for status, projects, ask, search, reindex, tasks, approvals, policy, audit, logs, Graphify, health, readiness, plugins, sessions and the read-only Stardust routes, each mapped to one HTTP call with fixed defaults.

#### Scenario: Workspace and query methods
- **WHEN** `addProject(p)`, `removeProject(p)` and `updateProjectPath(p, n)` are called
- **THEN** they send `POST`, `DELETE` and `PUT` to `/api/projects` with bodies `{path}` and `{path, nextPath}`
- **AND** `ask(q, id)` posts `{question, projectId}` to `/api/ask`, and `search(q, project, top)` sends `GET /api/search?query=...` adding `project` and `top` only when given

#### Scenario: Task and audit methods
- **WHEN** `approve(id, ok)`, `cancel(id)`, `taskEvents(id)`, `audit()`, `logs()`, `clearTasks()` and `clearAudit()` are called
- **THEN** they send `POST /api/agent/approve {taskId, approved}`, `POST /api/agent/cancel {taskId}`, `GET /api/agent/tasks/<encoded id>/events`, `GET /api/audit?limit=25`, `GET /api/logs?limit=200`, `DELETE /api/agent/tasks` and `DELETE /api/audit`

#### Scenario: Graphify methods
- **WHEN** the Graphify methods are called
- **THEN** `graphifyStatus`, `graphifyReport`, `graphifyBuildStatus`, `graphifyArtifact` and `graphifyMap` (default `limit` 80) use `GET /api/graphify/...` query strings
- **AND** `graphifyBuild`, `graphifyQuery`, `graphifyExplain`, `graphifyPath` and `graphifyAffected` (defaults `depth` 2, `relations` []) `POST` JSON to `/api/graphify/build`, `/query`, `/explain`, `/path` and `/affected`

### Requirement: Stardust reads use projectRoot
The client's Stardust methods SHALL be GET requests only and SHALL send the workspace as the `projectRoot` query parameter, omitting it when none is given.

#### Scenario: Drift and compose defaults
- **WHEN** `stardustDrift(root)` and `stardustCompose(root, file)` are called
- **THEN** they request `/api/stardust/drift?projectRoot=<root>&minDependents=2` and `/api/stardust/compose?projectRoot=<root>&file=<file>&depth=2&limit=5`

#### Scenario: Context file list
- **WHEN** `stardustContext(root, ['a.js', 'b.js'])` is called
- **THEN** it requests `/api/stardust/context` with `projectRoot` and `files=a.js,b.js`

#### Scenario: No root
- **WHEN** `stardustBoard()` or `stardustDiagnose()` is called with no root
- **THEN** the request has no query string and the runtime falls back to its own working directory

### Requirement: Agent task streaming
`runAgentTask(task, projectId, onEvent)` SHALL `POST /api/agent/task` with `{task, projectId}` and read the response as server-sent events. Each `data: ` line SHALL be parsed as JSON, checked with `assertTaskEvent` and passed to `onEvent` in order.

#### Scenario: Event frames
- **WHEN** the stream contains frames separated by a blank line, each with a `data: {...}` line
- **THEN** each frame's first `data: ` line is parsed and awaited through `onEvent`
- **AND** a final unterminated frame starting with `data: ` is also delivered

#### Scenario: Unknown event type
- **WHEN** a frame holds `{"type":"mystery"}`
- **THEN** reading stops with the error `Unsupported YodaMan task event: {"type":"mystery"}`

#### Scenario: Rejected task
- **WHEN** the task request returns a non-2xx status
- **THEN** the error message is the raw response body text

### Requirement: Shared protocol constants
`shared/yodamanProtocol.js` SHALL be generated from `shared/protocol.schema.json` by `npm run generate:protocol` and SHALL export frozen `TASK_EVENT_TYPES`, `TASK_STATUSES` and `PLUGIN_PERMISSIONS`, plus `isTaskEvent` and `assertTaskEvent`.

#### Scenario: Known values
- **WHEN** a client reads the constants
- **THEN** event types are `task_started`, `tool_start`, `tool_end`, `awaiting_approval`, `task_cancelled`, `final_answer`, `response_truncated`, `upload_error` and `error`
- **AND** statuses are `running`, `cancelling`, `cancelled`, `awaiting_approval`, `rejected`, `error` and `completed`, and permissions are `read`, `write`, `command`, `network`, `search` and `unrestricted`

#### Scenario: Event check
- **WHEN** `isTaskEvent` gets a value that is not an object or whose `type` is not a known event type
- **THEN** it returns false

#### Scenario: Type declarations
- **WHEN** a TypeScript consumer imports the package
- **THEN** `yodamanProtocol.d.ts` declares `YodaManTaskEvent` and `YodaManTask`, and `yodamanClient.d.ts` declares `API_PATHS` and the `YodaManClient` interface
- **AND** that interface declares exactly the methods `createYodaManClient` returns, which `tests/architecture/CompanionClientContracts.test.js` checks

### Requirement: Pairing and authentication
Clients SHALL authenticate to a non-local runtime only with a pairing token sent in the `X-YodaMan-Token` header. Requests from the same computer SHALL pass without a token, and the VS Code extension SHALL rely on that and send none.

#### Scenario: Remote client without a valid token
- **WHEN** pairing is required and a non-local request reaches any `/api` route other than `/pairing` without a valid token
- **THEN** the runtime answers 401 with `{"error":"Valid YodaMan pairing token is required","code":"pairing_token_required"}`

#### Scenario: Pairing link format
- **WHEN** a local caller sends `POST /api/pairing` (the client's `createPairing`, optionally with `{runtimeUrl}`)
- **THEN** the runtime answers 201 with `runtimeUrl`, `token`, `expiresAt` (24 hours later), `link` and `deepLink`, where the link is `yodaman://pair?url=<encoded url>&token=<encoded token>`

#### Scenario: Pairing from a phone
- **WHEN** a non-local caller sends any `/api/pairing` request
- **THEN** the runtime answers 403 with `Pairing can only be managed from this computer`

### Requirement: VS Code extension manifest
The extension `vscode-yodaman` SHALL require VS Code `^1.90.0`, activate on startup, and contribute the settings `yodaman.runtimeUrl` (default `http://localhost:3090`) and `yodaman.runtimeCommand` (default `yodaman`), 19 palette commands, and an activity-bar container `yodaman` holding the `yodaman.sidebar` view named `Agent`.

#### Scenario: Commands
- **WHEN** the user opens the command palette
- **THEN** it lists `yodaman.checkStatus`, `startRuntime`, `askWorkspace`, `runAgentTask`, `cancelAgentTask`, `searchWorkspace`, `addWorkspace`, `addWorkspaceFromPath`, `reindexWorkspace`, `openLogs`, `clearTasks`, `clearAudit`, `impactForFile`, `stardustBoard`, `showDrift`, `clearDrift`, `runtimeDiagnostics`, `showApprovals` and `listPlugins`, each titled `YodaMan: ...`

#### Scenario: Blast radius menus
- **WHEN** the user right-clicks in a focused editor or in the Explorer
- **THEN** `YodaMan: Blast Radius For This File` appears in group `navigation@9`

#### Scenario: Packaging
- **WHEN** `vsce package` or `vsce publish` runs
- **THEN** `vscode:prepublish` runs `node --check src/extension.js` and `copy-shared.js`, which copies `shared/yodamanClient.js` and `shared/yodamanProtocol.js` into `src/shared`
- **AND** at runtime the extension loads `./shared/yodamanClient` and falls back to `../../../shared/yodamanClient` only on `MODULE_NOT_FOUND`

### Requirement: Extension runtime status
On activation the extension SHALL create the `YodaMan` output channel and a left status bar item bound to `yodaman.checkStatus`, then check `GET /api/status` silently. Commands that need the runtime SHALL first check status and offer to start it when it is offline.

#### Scenario: Status shown
- **WHEN** the status check succeeds or fails
- **THEN** the status bar reads `$(check) YodaMan` or `$(warning) YodaMan`, and the sidebar refreshes

#### Scenario: Offline prompt
- **WHEN** a command runs while the runtime is offline
- **THEN** a warning `YodaMan runtime is offline. Start it now with "<runtimeCommand>"?` offers `Start Runtime` and `Open Settings`, and the command stops
- **AND** `Start Runtime` sends the command to a terminal named `YodaMan Runtime`, while `Open Settings` opens settings filtered to `yodaman.runtime`

#### Scenario: Empty runtime command
- **WHEN** `yodaman.startRuntime` runs with an empty `yodaman.runtimeCommand`
- **THEN** it warns `Set yodaman.runtimeCommand before starting the runtime.` and starts nothing

### Requirement: Extension ask, search and agent tasks
The extension SHALL scope ask, search, reindex and agent tasks to the first workspace folder path. Agent tasks SHALL stream events into the output channel and gate each `awaiting_approval` event on a modal Approve or Reject choice shown beside a diff.

#### Scenario: Ask
- **WHEN** the user runs `YodaMan: Ask About Workspace` with the runtime online
- **THEN** it calls `ask(question, root)` and prints the answer, or the whole response as JSON when it has no `answer`; a failure prints `[error] <message>` and shows `YodaMan ask failed: <message>`

#### Scenario: Search opens a hit
- **WHEN** a search returns hits (an array, or `results` or `hits` in the payload)
- **THEN** a quick pick lists each file, read from `metadata.path`, `filePath`, `path` or `file` in that order, with `score <graphRank to 3 places>`, `spec` when `specFlag.covered`, and the hit's `_source`
- **AND** picking one opens the file, joining a relative path to the workspace folder; with no hits it shows `YodaMan: no matches for "<query>".`

#### Scenario: Write approval
- **WHEN** an `awaiting_approval` event arrives
- **THEN** the extension writes the proposal to its global storage `diffs` folder, opens `vscode.diff` titled `YodaMan proposal: <file>`, asks `Approve YodaMan write to <filePath>?`, and posts `approve(taskId, choice === 'Approve')`

#### Scenario: Cancel with no task
- **WHEN** `YodaMan: Cancel Active Agent Task` runs with no active task
- **THEN** it shows `No active YodaMan task to cancel.`

### Requirement: Extension sidebar and housekeeping
The `Agent` sidebar SHALL show four expanded groups: `Status & Info`, `Actions`, `Pillar & Stardust` and `Recent Tasks`. Clearing tasks or audit logs SHALL require a modal `Clear` confirmation.

#### Scenario: Recent tasks
- **WHEN** the runtime is online and `Recent Tasks` expands
- **THEN** up to 5 tasks show with labels cut to 27 characters plus `...` when longer than 30, a status icon and `[<status>]`
- **AND** clicking one runs `yodaman.viewTaskDetails`, which prints the task and its events to the output channel

#### Scenario: Offline tasks
- **WHEN** the runtime is offline
- **THEN** `Recent Tasks` shows `Runtime offline` with `Cannot fetch task history`

#### Scenario: Logs
- **WHEN** `YodaMan: Open Runtime Logs` runs
- **THEN** it fetches `GET /api/logs?limit=300` and prints the queue and each entry as `[<timestamp>] <LEVEL> <message> <meta JSON>`

### Requirement: Extension pillar commands
`src/coreSurface.js` SHALL provide blast radius for the active file, the Stardust board, spec drift as Problems-panel diagnostics, runtime diagnostics, pending approvals and the plugin list, using the same client and availability check as `extension.js`.

#### Scenario: Blast radius
- **WHEN** `YodaMan: Blast Radius For This File` runs on an open file in a workspace
- **THEN** it calls `stardustCompose(root, relativePath, 2)` and prints dependents, blast radius, centrality, tests, the ids of the specs that mention the file, risk and note
- **AND** it shows a warning when the file has dependents but no covering test, otherwise an information message

#### Scenario: Drift diagnostics
- **WHEN** `YodaMan: Check Spec Drift` succeeds
- **THEN** it replaces the `yodaman-drift` collection with warnings `Spec "<spec>" cites "<reference>", which is not in the knowledge graph.` and information items `No OpenSpec spec describes this file, and <n> module(s) depend on it.`, sourced `YodaMan drift`
- **AND** stale-reference warnings are placed on the spec file, `<root>/openspec/specs/<spec id>` (the id is relative to `openspec/specs` and keeps its `.md`)

#### Scenario: Diagnostics without one subsystem
- **WHEN** `YodaMan: Runtime Diagnostics` runs and one of health, readiness or diagnose fails
- **THEN** the others still print, with `ctx`, `graphify`, `openspec` and `ollama` marked `ok`, `FAIL`, `...` or `?`, and a failed diagnose prints `openspec diagnose unavailable: <message>`

#### Scenario: Stardust command fails
- **WHEN** a blast radius, board or drift command gets an error, such as an unregistered workspace
- **THEN** it shows `YodaMan impact failed: <message>`, `YodaMan Stardust board failed: <message>` or `YodaMan drift failed: <message>`

#### Scenario: Approvals and plugins
- **WHEN** `YodaMan: Pending Approvals` or `YodaMan: List Plugins` finds nothing
- **THEN** it shows `YodaMan: no pending approvals.` or `YodaMan: no plugins loaded.`

#### Scenario: Approval decision
- **WHEN** the user picks a pending approval and chooses `Approve` or `Reject`
- **THEN** it posts `approve(taskId, choice === 'Approve')` and shows `YodaMan: approved <file>.` or `YodaMan: rejected <file>.`

### Requirement: Mobile app configuration
The Expo app SHALL be named `YodaMan` with slug `yodaman-mobile`, scheme `yodaman`, bundle id and package `com.yodaman.mobile`, portrait dark UI, and SHALL allow cleartext local-network HTTP so it can reach a runtime on the user's own computer.

#### Scenario: Platform network settings
- **WHEN** the app is built
- **THEN** iOS sets `NSAllowsLocalNetworking` true with a local network usage description, and Android requests `INTERNET` and `ACCESS_NETWORK_STATE` with `usesCleartextTraffic` true

#### Scenario: Shared client in the bundle
- **WHEN** Metro bundles the app
- **THEN** `src/api/yodamanClient.js` wraps core's `shared/yodamanClient` as `createYodaManClient(runtimeUrl, pairingToken)`, and `metro.config.js` watches `../../shared`

### Requirement: Mobile connect and pairing
The mobile app SHALL start with runtime URL `http://127.0.0.1:3090` and an empty pairing token, and SHALL accept a pasted `yodaman://pair` link to fill both. Connect SHALL load status, health, projects and readiness and select the first project.

#### Scenario: Pairing link
- **WHEN** the user pastes `yodaman://pair?url=...&token=...` into the Runtime URL field and taps `Use pairing link`
- **THEN** the URL and token fields are replaced with the link's `url` and `token`

#### Scenario: Bad pairing link
- **WHEN** the field does not start with `yodaman://pair`, or the link lacks `url` or `token`
- **THEN** an alert `Pairing link failed` shows `Paste a yodaman://pair link into the Runtime URL field first.` or `Pairing link is missing url or token.`

#### Scenario: Request failure
- **WHEN** any request fails
- **THEN** an alert shows the error
- **AND** only when the runtime gave no answer (the error has no HTTP `status`) does the header pill turn `Offline` and a `Runtime unavailable` notice tell the user to start the desktop app and check the URL and token; an answer such as an unregistered workspace leaves the connection shown as online

### Requirement: Mobile tabs
The app SHALL show six tabs: `Connect`, `Ask`, `Stardust`, `Impact`, `Tasks` and `Approvals`. Stardust and Impact SHALL only read; the only write SHALL be approving or rejecting a write proposal after an alert confirmation.

#### Scenario: Ask and search
- **WHEN** the user asks or searches on the Ask tab
- **THEN** the request is scoped to the selected project, the answer text is shown, and up to 25 hits are listed by the path `shared/searchHits.js` `hitPath` reads, with a `spec` pill when `specFlag.covered`

#### Scenario: Impact depth
- **WHEN** the user picks a depth of 1 to 4 hops (default 2) and taps `Analyze`
- **THEN** the app calls `stardustCompose(project, file, depth)` and shows the JSON result cut to 4000 characters

#### Scenario: Approval gate
- **WHEN** the user taps `Approve` or `Reject` on a pending approval and confirms the `Approve write?` or `Reject write?` alert
- **THEN** the app posts the decision and reloads pending approvals
- **AND** each card shows `Dependents` from `approval.impact.impactedCount`, and `Test coverage` from `approval.impact.testCount`: `<n> covering test(s)`, `no covering test`, or the impact's `reason` when it is unavailable

#### Scenario: Drift list
- **WHEN** the Stardust tab loads drift
- **THEN** it lists each `staleReferences` entry (the cited file and the spec citing it) and each `undocumented` module with its dependent count
- **AND** with nothing to list it shows `Drift unavailable: <reason>` when the report is unavailable, otherwise `No drift reported. Load the board first.`
- **AND** a pull-to-refresh failure on the Stardust tab shows a `Stardust failed` alert instead of being ignored

#### Scenario: Cancel a task
- **WHEN** a listed task is `running`, `awaiting_approval` or `cancelling`
- **THEN** it shows a `Cancel` button that posts `cancel(taskId)` and reloads the task list
