## MODIFIED Requirements

### Requirement: Registered workspaces only
Every `/api/stardust/*` route and the `/api/stardust/live` WebSocket SHALL take its workspace from `projectRoot`, in the query or the JSON body. A given `projectRoot` MUST be a registered workspace; an omitted one SHALL mean the runtime's working directory. Every error answer SHALL be `{ error, code }`.

#### Scenario: Unregistered folder
- **WHEN** `projectRoot` names a folder that is not a registered workspace
- **THEN** the route answers 404 `workspace_not_registered` and reads or writes nothing in that folder

#### Scenario: Unregistered folder on the live socket
- **WHEN** a WebSocket connects with such a `projectRoot`
- **THEN** it gets `{ type: "error", message, code: "workspace_not_registered" }` and is closed with code 1008, and no watcher starts

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
