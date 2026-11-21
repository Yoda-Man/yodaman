## MODIFIED Requirements

### Requirement: Move a workspace
`PUT /api/projects` with body `{ path, nextPath }` SHALL replace a registered path with a new one in `watchedDirectories`, clear `nextPath` from `removedDirectories`, save, stop the old watcher, remove the old path's ctx index in the background, start a watcher on the new path and queue it for indexing. `nextPath` MUST pass the same checks as `POST /api/projects`.

#### Scenario: Path updated
- **WHEN** `/w/old` is registered and the body is `{ "path": "/w/old", "nextPath": "/w/new" }`
- **THEN** the response is 200 `{ "message": "Project path updated", "path": "/w/new", "previousPath": "/w/old" }`

#### Scenario: Unknown or taken path
- **WHEN** `path` is not registered
- **THEN** the response is 404 `{ "error": "Project path is not being watched", "code": "project_not_found" }`
- **AND** when `nextPath` is already registered the response is 409 with `Target project path is already being watched` and `code` `project_exists`

#### Scenario: Same path
- **WHEN** `path` and `nextPath` resolve to the same path
- **THEN** the response is 200 `{ "message": "Project path unchanged", "path": <path> }`

#### Scenario: Invalid nextPath
- **WHEN** `nextPath` is missing or empty
- **THEN** the response is 400 with `nextPath must be a non-empty string` and `code` `invalid_path`
- **AND** a `nextPath` that does not exist gets 404 `workspace_missing`, and generated output such as `node_modules` gets 400 `workspace_generated`, with nothing saved

### Requirement: Manual reindex
`POST /api/reindex` with body `{ path }` SHALL queue a registered, existing workspace for indexing and the Graphify update that follows. It MUST refuse a path that is not registered.

#### Scenario: Queued
- **WHEN** a client posts a registered workspace path
- **THEN** the response is 200 `{ "message": "Indexing and Graphify graph update queued" }`

#### Scenario: Not registered
- **WHEN** the path is not in `watchedDirectories`
- **THEN** the response is 404 with `Workspace is not registered: <path>` and `code` `workspace_not_registered`, and `reindex_rejected` is logged

#### Scenario: Folder gone
- **WHEN** the registered folder no longer exists
- **THEN** the response is 404 with `Workspace path does not exist: <path>` and `code` `workspace_missing`

### Requirement: Workspace readiness
`GET /api/readiness` SHALL grade each workspace as `missing`, `unindexed`, `building`, `stale` or `ready` (worst to best) from its Graphify layer and its index layer. The overall state MUST be the weakest layer. Readiness MUST NOT throw for a single workspace; a failure of the route returns 500 with `code` `readiness_failed`. A `projectId` MUST be a registered workspace.

#### Scenario: All workspaces
- **WHEN** a client calls `GET /api/readiness` with no query
- **THEN** the response is `{ overall, trustworthy, workspaces: [report, ...] }` for every watched directory, read from `config.json` on this request
- **AND** `overall` is `unindexed` when no workspace is registered, and `trustworthy` is true only when `overall` is `ready`

#### Scenario: Unregistered workspace
- **WHEN** `projectId` is neither a registered path nor a registered folder name
- **THEN** the answer is 404 with `code` `workspace_not_registered`

#### Scenario: One workspace with coverage
- **WHEN** a client calls `GET /api/readiness?projectId=/w/app`, the state is `ready` and spec drift is available
- **THEN** the report has `path`, `state`, `trustworthy`, `layers.graph`, `layers.index`, `action` and a `coverage` object with `covered`, `specCount`, `undocumentedCount`, `staleCount`, up to 3 `hubs` and a `headline`
- **AND** `action` is the coverage headline

#### Scenario: Layer states
- **WHEN** the graph build state is `running`, or the path is queued or being indexed
- **THEN** that layer is `building`
- **AND** the graph layer is `unindexed` with no graph and `stale` when a source file is newer than `graph.json`, and the action reads `Run Sync Repository to build the knowledge graph.` or `Run Sync Repository to refresh the graph before relying on answers.`

#### Scenario: Folder gone
- **WHEN** the workspace folder does not exist
- **THEN** the state is `missing`, `trustworthy` is false, both layers are `{ state: "missing", detail: "workspace folder not found" }`
- **AND** `action` is `The workspace folder was not found. It may have been moved or deleted: edit its path in Settings, or remove it there.`
