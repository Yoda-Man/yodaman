# Spec Workflow Specification

## Purpose
Stardust is YodaMan's wrapper around the OpenSpec CLI. It runs `openspec` as a subprocess (`backend/stardust/StardustWrapper.js`), compares specs with the knowledge graph (`SpecDrift.js`), drafts baseline specs with the local model (`SpecBaseline.js`), pushes a live change board over a WebSocket (`StardustLive.js`), and composes the brief the agent reads first (`backend/core/StardustBrief.js`). Its HTTP routes are in `backend/interfaces/routes/stardustRoutes.js` and its UI in `src/components/Stardust.jsx` with its panels and `src/hooks/useStardust*.js`.

## Requirements

### Requirement: OpenSpec CLI subprocess
Stardust SHALL run the official `openspec` CLI as a child process and never reimplement it. It SHALL use the `openspec` found on PATH and fall back to `npx openspec`, caching the choice. Each run SHALL resolve to `{ stdout, stderr, code, success }` and MUST never reject.

#### Scenario: Timeout
- **WHEN** a command runs longer than its timeout, 60 seconds by default
- **THEN** it is sent SIGTERM, then SIGKILL 5 seconds later, and resolves with `success: false`, `code: null` and `[TIMEOUT] Command timed out after <ms>ms` appended to `stderr`

#### Scenario: Cannot start
- **WHEN** the process fails to start
- **THEN** it resolves with `success: false`, `code: null` and `[ERROR] <message>` appended to `stderr`, logging `openspec_spawn_failed` once

#### Scenario: Commands
- **WHEN** Stardust validates, archives, lists or initializes
- **THEN** it runs `openspec validate <name>`, `openspec archive <name>`, `openspec list --json` (plus `--specs` for specs), or `openspec init <root> --tools <tools> --force` with the workspace as working directory

### Requirement: Registered workspaces only
Every `/api/stardust/*` route and the `/api/stardust/live` WebSocket SHALL take its workspace from `projectRoot`, in the query or the JSON body. A given `projectRoot` MUST be a registered workspace; an omitted one SHALL mean the runtime's working directory. Every error answer SHALL be `{ error, code }`.

#### Scenario: Unregistered folder
- **WHEN** `projectRoot` names a folder that is not a registered workspace
- **THEN** the route answers 404 `workspace_not_registered` and reads or writes nothing in that folder

#### Scenario: Unregistered folder on the live socket
- **WHEN** a WebSocket connects with such a `projectRoot`
- **THEN** it gets `{ type: "error", message, code: "workspace_not_registered" }` and is closed with code 1008, and no watcher starts

### Requirement: Diagnose
`GET /api/stardust/diagnose?projectRoot=<path>` SHALL report whether the CLI is installed and whether the workspace has OpenSpec. The workspace SHALL count as initialized when `openspec/config.yaml`, `openspec/specs/` or `openspec/changes/` exists, checked in that order.

#### Scenario: Report fields
- **WHEN** the route is called
- **THEN** it returns `{ installed, version, projectRootFound, projectMdPath, binary, errors, _debug }`, where `version` is the trimmed output of `openspec --version` (15-second timeout) and `projectMdPath` is the first path found

#### Scenario: No version output
- **WHEN** `openspec --version` prints nothing and fails
- **THEN** `installed` is false and `errors` contains `Version check returned no output (exit code: <code>). Raw stderr: "<first 200 chars>"`

#### Scenario: No projectRoot
- **WHEN** `projectRoot` is omitted
- **THEN** the runtime's working directory is checked

### Requirement: Run an OpenSpec action
`POST /api/stardust/run` SHALL accept `{ action, changeId, description, projectRoot, specs, tools }` and run `diagnose`, `validate`, `archive`, `list`, `init`, `install` or `propose`. It SHALL answer `{ success, stdout, stderr, exitCode }`, adding `diagnostics` for `diagnose`.

#### Scenario: Missing fields
- **WHEN** `action` is missing, or `validate`, `archive` or `propose` has no `changeId`, or `init` has no `projectRoot`
- **THEN** the server answers 400 with `Missing required field: action` (`action_required`), `validate requires changeId`, `archive requires changeId` or `propose requires changeId` (`change_id_required`), or `init requires projectRoot` (`project_root_required`)

#### Scenario: Unknown action
- **WHEN** `action` is not one of the seven
- **THEN** the server answers 400 `unknown_action` with `Unknown stardust action: <action>`

#### Scenario: Validate stores its result
- **WHEN** `validate` finishes
- **THEN** its result is stored for that workspace and change as `ok` when it succeeded and `error` otherwise

#### Scenario: Install is gated
- **WHEN** `action` is `install`
- **THEN** it answers 403 `self_heal_install_disabled` unless the `allowSelfHealInstall` setting is on, and 403 `repair_local_only` with `Installs can only be started from this computer` for a non-local request
- **AND** otherwise it runs `npm install -g @fission-ai/openspec`, stopped after 120 seconds, and clears the cached binary

#### Scenario: Init defaults
- **WHEN** `init` has no `tools`
- **THEN** it runs with `--tools all`

### Requirement: Propose a change
The `propose` action SHALL create `openspec/changes/<changeId>/` with `proposal.md`, `design.md` and `tasks.md`, and MUST NOT overwrite any of them that already exist. A change name containing `/`, `\` or `..` MUST be rejected with 400 `invalid_change_name`.

#### Scenario: New change
- **WHEN** `propose` runs for `add-auth`
- **THEN** `proposal.md` holds `# add-auth` and the description or `Proposed change.`, `design.md` holds Approach, Tradeoffs and Affected modules headings, and `tasks.md` holds three unchecked tasks
- **AND** `stdout` is `Change "add-auth" proposed. Created: proposal.md, design.md, tasks.md.`

#### Scenario: Existing change
- **WHEN** all three files already exist
- **THEN** nothing is written and `stdout` is `Change "add-auth" already exists (proposal.md, design.md, tasks.md). Use validate to check it.`

#### Scenario: Unsafe name
- **WHEN** `changeId` is `../x`
- **THEN** the server answers 500 with `changeName must not contain path separators or ".."`

### Requirement: Architecture drift
`GET /api/stardust/drift?projectRoot=<path>&minDependents=<n>` SHALL compare the specs with the knowledge graph. It SHALL report stale references, which are source paths a spec cites that the graph has never seen, and undocumented modules, which have at least `minDependents` dependents (default 2) and are cited by no spec.

#### Scenario: Report fields
- **WHEN** a graph exists
- **THEN** the response has `available: true`, `covered`, `openSpecInitialized`, `specCount`, `graphFileCount`, `documentedFiles`, `staleReferences`, `staleCount`, up to 20 `undocumented`, `undocumentedCount`, `inSync` and a `summary` text

#### Scenario: Citation by name
- **WHEN** a spec cites `SpecDrift.js` and the graph holds `backend/stardust/SpecDrift.js`
- **THEN** the file counts as documented, not stale
- **AND** `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE.md`, `node_modules/` paths and `.md`, `.txt`, `.yaml`, `.yml` and `.lock` files are never counted as references

#### Scenario: No specs
- **WHEN** a graph exists but there are no specs
- **THEN** `covered` and `inSync` are false and the undocumented modules are still reported

#### Scenario: No graph
- **WHEN** no knowledge graph has been built
- **THEN** the report is `{ available: false, reason: "no knowledge graph has been built for this workspace yet" }` and the summary starts `Architecture drift unavailable`

### Requirement: Change board snapshot
`GET /api/stardust/board?projectRoot=<path>` SHALL return `{ changes, ready, graphStatus }`. Each change under `openspec/changes/`, except the `archive/` folder, SHALL have `name`, `status`, `taskCompleted`, `taskTotal`, `validation` and `mtimeMs`, newest first.

#### Scenario: Task counts
- **WHEN** `tasks.md` has `- [ ]` and `- [x]` lines
- **THEN** `taskTotal` counts both and `taskCompleted` counts the checked ones

#### Scenario: Status and validation
- **WHEN** the board is built
- **THEN** `validation` is the last value stored for that change in that workspace, or `unknown`, and `status` is `applied` when `tasks.md` has tasks and all are checked, `validated` when `validation` is `ok`, and `proposed` otherwise

#### Scenario: Store a validation result
- **WHEN** a client calls `PUT /api/stardust/validation/<name>` with `{ "status": "ok" }`, `"warn"` or `"error"` and the workspace's `projectRoot`
- **THEN** the value is kept in memory for that workspace and change, and the server returns `{ ok: true, change, validation }`, and any other status answers 400 `invalid_validation_status` with `status must be ok, warn, or error`

#### Scenario: No OpenSpec
- **WHEN** the workspace has no OpenSpec folder
- **THEN** the snapshot is `{ changes: [], ready: false, graphStatus: "unavailable" }`, and otherwise `graphStatus` is `current`, `stale` or `unavailable` from Graphify's freshness check

### Requirement: Live board WebSocket
The server SHALL accept WebSocket connections at `/api/stardust/live?projectRoot=<path>` that pass the REST origin and pairing gates, send a `snapshot` message at once, and watch that workspace's `openspec/` folder. It SHALL send file events only to clients of the same workspace, with one shared watcher per OpenSpec root.

#### Scenario: File changes
- **WHEN** a file under `openspec/` is created, changed or removed
- **THEN** each client of that workspace gets `{ type: "activity", data: { event, path, detail, timestamp } }` with `event` such as `created`, `modified` or `removed`, followed by a fresh `snapshot`

#### Scenario: Watcher lifetime
- **WHEN** the first client for an OpenSpec root connects
- **THEN** a chokidar watcher starts (dot-files ignored, depth 10), and it closes when the last client for that root disconnects or a send to it fails

#### Scenario: Snapshot fails
- **WHEN** building the first snapshot throws
- **THEN** the client gets `{ type: "error", message }`

### Requirement: Spec deltas and current spec
`GET /api/stardust/deltas/<name>` SHALL return `{ change, deltas }`, parsing `openspec/changes/<name>/specs/**/*.md` into `ADDED`, `MODIFIED`, `REMOVED` and `RENAMED` requirements. `GET /api/stardust/spec?spec=<id>` SHALL return the published spec's text from `openspec/specs/<id>.md`, or else OpenSpec's own layout `openspec/specs/<id>/spec.md`, confined to the specs folder.

#### Scenario: Delta entries
- **WHEN** a delta file has `## ADDED Requirements` followed by `### Requirement: X`
- **THEN** the delta is `{ op: "ADDED", requirement: "Requirement: X", body, specId }`, where `specId` is the path under the change's `specs/` folder without `.md`

#### Scenario: Read a published spec
- **WHEN** `openspec/specs/<id>.md` or `openspec/specs/<id>/spec.md` exists
- **THEN** the route returns `{ available: true, id, path, text }`, and otherwise `available: false` with `no published spec by this name — the change would create it`, or `OpenSpec is not initialized in this workspace`

#### Scenario: Bad spec id
- **WHEN** `spec` is missing, or either form resolves outside the specs folder
- **THEN** the route answers 400 `spec_required` with `spec query parameter is required`, or `spec_outside_specs` with `spec id resolves outside the specs directory`

#### Scenario: Change name outside the changes folder
- **WHEN** the change name contains `/` (for example `..%2Fsecret`, which Express decodes) or starts with `.`
- **THEN** the deltas list is empty and nothing outside `openspec/changes/<name>/` is read

### Requirement: Change impact
`GET /api/stardust/change-impact/<name>` SHALL resolve every source file a change's deltas cite against the graph and report each one's blast radius, test coverage and risk, riskiest first. A cited file the graph has never seen SHALL be reported as stale, not dropped.

#### Scenario: Graph built
- **WHEN** the graph exists
- **THEN** each entry has `reference`, `file`, `inGraph`, `stale`, `requirements`, and for files in the graph `dependents`, `centrality`, `blastRadius`, `coveredByTests`, `testCount`, `risk` and `summary`
- **AND** `totals` gives `inGraph`, `stale`, the summed `blastRadius`, `untested` and `highestRisk`

#### Scenario: Ordering
- **WHEN** entries are sorted
- **THEN** stale ones come first, then by risk `high`, `moderate`, `low`, then by blast radius

#### Scenario: No graph
- **WHEN** no graph has been built
- **THEN** the route returns `available: false`, the reason, `deltaCount`, `citedCount` and `files: []`

### Requirement: Compose and authoring context
`GET /api/stardust/compose?file=<path>` SHALL report one file through all three tools in one response: the specs that cite it, its graph position, and its Context Expert neighbours from the shared search pipeline. Each tool SHALL report its own availability so one missing tool blanks only its own part.

#### Scenario: Compose a file
- **WHEN** a client asks for `file=backend/core/QueueService.js&depth=3&limit=10`
- **THEN** the response has `openspec.mentionedIn`, `graphify` with `dependents`, `centrality`, `blastRadius`, `nearestDependents`, `testFiles`, `risk` and `stale`, and up to 6 `contextExpert.neighbours` from a `code` search for the file's base name
- **AND** `depth` is clamped to 1 through 4 (default 2) and `limit` to 1 through 200 (default 5)

#### Scenario: Missing file
- **WHEN** `file` is missing
- **THEN** the route answers 400 `file_required` with `file query parameter is required`

#### Scenario: Authoring context
- **WHEN** a client calls `GET /api/stardust/context?files=a.js,b.js`
- **THEN** it returns the graph's size, the 10 most central files as `architecturalHubs`, and per-file impact for up to 25 files, or `available: false` with `hint: "Run Sync Repository, then request context again."` when no graph exists

### Requirement: Baseline spec drafts
Stardust SHALL draft one spec per top-level module for a workspace, using Graphify to group files, Context Expert through the search pipeline to retrieve code, and the local model through `ctx ask`. Drafting MUST write nothing and MUST NOT replace an existing spec.

#### Scenario: Capabilities
- **WHEN** drafts are requested with `maxCapabilities` (default 6, at most 12)
- **THEN** non-test code files are grouped by their first two folders, ranked by total dependents, and each draft targets `openspec/specs/<kebab-case module>/spec.md` with its 5 most depended-on files

#### Scenario: Draft format
- **WHEN** the model answers
- **THEN** only blocks that contain SHALL or MUST and a `#### Scenario:` are kept, at most 8, under a Purpose that starts `DRAFT, generated by YodaMan's local model`

#### Scenario: Skipped capabilities
- **WHEN** a spec already exists, the model returns no usable requirement, or drafting throws
- **THEN** the capability is listed in `skipped` with `a spec already exists`, `the local model returned no usable requirements`, or the error

#### Scenario: No graph
- **WHEN** no graph exists
- **THEN** the result is `available: false` with the reason `no knowledge graph has been built for this workspace yet. Run Sync Repository, then try again`

### Requirement: Stardust Brief
For every model-loop agent task with a workspace, the system SHALL build a brief from Graphify, OpenSpec and drift, scoped to the files the task names. A missing tool MUST degrade to one explanatory line and never fail the task.

#### Scenario: Brief content
- **WHEN** a graph and specs exist
- **THEN** the brief states the graph's file and edge counts (with `GRAPH IS STALE` when stale), the 5 busiest modules, the spec count and ids, drift counts, up to 5 undocumented hubs, and the `God Nodes` and `Surprising Connections` sections of `GRAPH_REPORT.md` within 1600 characters

#### Scenario: Files named in the task
- **WHEN** the task mentions `ToolBox.js` and the graph holds `backend/infrastructure/ToolBox.js`
- **THEN** up to 6 such files are listed with risk, dependents within 2 hops, covering tests or `NO covering tests`, and the specs that describe them

#### Scenario: No graph
- **WHEN** no graph exists
- **THEN** the brief says `Graphify: no knowledge graph for this workspace yet.` and tells the model not to guess at dependencies

### Requirement: Stardust UI
The Stardust view SHALL show the selected workspace's change board, drift, compose, trust, trace, diagnostics, commands and impact tabs, seed the board over REST, and keep it live over the WebSocket. Its Draft Specs button MUST hand the work to Chat so every write passes the approval gate.

#### Scenario: Live connection
- **WHEN** the view opens for a workspace
- **THEN** it loads `GET /api/stardust/board`, opens `/api/stardust/live`, and reconnects 3 seconds after the socket closes

#### Scenario: Validate from the board
- **WHEN** the user validates a change
- **THEN** `POST /api/stardust/run` runs `validate`, which stores the result for the board, and the view also sends it with `PUT /api/stardust/validation/<name>` as `ok` or `error`

#### Scenario: Draft Specs
- **WHEN** the user presses Draft Specs on the Commands tab
- **THEN** the view dispatches `yodaman:ask-agent` with `{ prompt: "Draft baseline specs", send: true }`

#### Scenario: Diagnostics actions
- **WHEN** diagnostics show the CLI missing or the workspace uninitialized
- **THEN** the tab offers Install Now, which runs `install`, or Initialize Project, which runs `init` with `tools: "all"`
