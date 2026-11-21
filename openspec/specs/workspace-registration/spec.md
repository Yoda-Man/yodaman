# Workspace Registration Specification

## Purpose
A workspace is a folder YodaMan indexes with Context Expert (ctx), builds a Graphify graph for, and watches for changes. This capability covers the `/api/projects` routes in `backend/interfaces/RestController.js`, path validation in `backend/interfaces/support/workspaces.js`, indexing in `backend/core/QueueService.js`, `POST /api/reindex`, `GET /api/check`, `GET /api/readiness` (`backend/infrastructure/WorkspaceReadiness.js`), file watching (`backend/infrastructure/FileSystemWatcher.js`), the startup sync in `server.js`, the shared ignore lists (`shared/ignoredPaths.js`, `shared/generatedPaths.js`, `shared/workspaceFiles.js`) and where the list is stored (`backend/infrastructure/DataPaths.js`, `backend/infrastructure/Database.js`).

## Requirements

### Requirement: Workspace list storage
The workspace list SHALL be stored in `config.json` as `watchedDirectories` (registered absolute paths) and `removedDirectories` (paths the user removed). `config.json` MUST live in the per-user data folder, not the install folder. A missing or unparsable file SHALL read as an empty list rather than fail a request.

#### Scenario: Default location
- **WHEN** no override is set
- **THEN** the data folder is `~/Library/Application Support/YodaMan` on macOS, `%APPDATA%\YodaMan` on Windows and `$XDG_CONFIG_HOME/YodaMan` (default `~/.config/YodaMan`) on Linux
- **AND** the list is in `config.json` in that folder

#### Scenario: Overrides
- **WHEN** `YODAMAN_DATA_DIR` is set
- **THEN** the data folder is that path, resolved to absolute
- **AND** `YODAMAN_CONFIG_PATH`, when set, names the config file directly and wins over the data folder

#### Scenario: Corrupt config
- **WHEN** `config.json` is not valid JSON
- **THEN** the error is logged as `config_load_failed` and the routes act as if no workspace is registered
- **AND** non-array `watchedDirectories` or `removedDirectories` values are treated as empty arrays

### Requirement: Data folder preparation and migration
Before the database or config is first written, the system SHALL create the data folder and copy `config.json`, `yodaman.db` and `sessions.json` from the install folder when the data folder lacks them. Copies MUST never overwrite or move the source. The database (`yodaman.db`, override `YODAMAN_DB_PATH`) holds task history and the audit log, not workspaces.

#### Scenario: First run after upgrade
- **WHEN** the install folder holds `config.json` and the data folder has none
- **THEN** it is copied once with an exclusive copy, and the result lists it under `copied`
- **AND** `yodaman.db` is copied with SQLite `VACUUM INTO`, so rows still in the WAL file are kept

#### Scenario: Copy fails
- **WHEN** a copy throws
- **THEN** the file is listed under `failed` with its error and the server logs `data_migration_failed`
- **AND** the original file is left untouched

#### Scenario: Database tables
- **WHEN** `node:sqlite` is available
- **THEN** `yodaman.db` has the tables `tasks` and `audit_logs`
- **AND** when it is not available the module logs `database_sqlite_unavailable` and exports `db` as null and `useSqlite` as false

### Requirement: List workspaces
`GET /api/projects` SHALL return a JSON array that merges the projects `ctx list --json` reports with registered paths ctx has not indexed. Removed paths and YodaMan's own temp workspaces MUST be left out of the ctx part. If ctx cannot be listed, the route SHALL still answer 200 from the config alone.

#### Scenario: Indexed workspace
- **WHEN** ctx lists a project at `/w/app` with `fileCount` 10 and `chunkCount` 40
- **THEN** the entry is `{ name: "app", indexName: <ctx name>, path: "/w/app", id, files: 10, chunks: 40, indexed: true }`
- **AND** `files` and `chunks` fall back to ctx's `files` and `chunks` fields, then 0

#### Scenario: Registered but not indexed
- **WHEN** `/w/new` is in `watchedDirectories` but not in ctx's list
- **THEN** the array also holds `{ name: "new", path: "/w/new", id: "/w/new", files: 0, chunks: 0, indexed: false }`

#### Scenario: Unreadable config
- **WHEN** `config.json` cannot be parsed at startup
- **THEN** `config_unreadable_at_startup` is logged, the config health check fails, and ctx projects are not merged or saved over it

#### Scenario: ctx unavailable
- **WHEN** `ctx list` fails
- **THEN** the route logs `projects_list_ctx_failed` and returns one `indexed: false` entry per watched directory

#### Scenario: Temp workspace filtered
- **WHEN** a path sits directly in the OS temp folder and its folder name starts with `yodaman-graph-studio-`, `yodaman-graphify-service-`, `yodaman-graph-doctor-`, `yodaman-docs-`, `yodaman-audit-test-` or `yodaman-test-`
- **THEN** it is never listed, and loading the config removes it from `watchedDirectories` and saves the file

### Requirement: Register a workspace
`POST /api/projects` with body `{ path }` SHALL resolve the path to absolute, check it, add it to `watchedDirectories`, clear it from `removedDirectories`, save the config, start a watcher and queue it for indexing. Registering a path twice MUST NOT add it twice.

#### Scenario: New workspace
- **WHEN** a client posts `{ "path": "/w/app" }` for an existing directory
- **THEN** the response is 201 `{ "message": "Project added", "path": "/w/app" }`
- **AND** a watcher starts and `/w/app` is queued for `ctx index`

#### Scenario: Already registered
- **WHEN** the path is already in `watchedDirectories`
- **THEN** the response is 200 `{ "message": "Already exists" }` and nothing is queued

#### Scenario: Bad path
- **WHEN** `path` is missing, empty or not a string
- **THEN** the response is 400 `{ "error": "path must be a non-empty string", "code": "invalid_path" }`
- **AND** a path containing a null byte gets 400 `path cannot contain null bytes`, and one over 4096 characters gets 400 `path must be 4096 characters or fewer`

### Requirement: Workspace candidate checks
A registered path MUST exist, MUST be a directory, and its folder name MUST NOT be one of the ignored directories in `shared/ignoredPaths.js`. A generated folder SHALL never become a workspace.

#### Scenario: Missing folder
- **WHEN** the path does not exist
- **THEN** the response is 404 with `error` `Workspace path does not exist: <path>` and `code` `workspace_missing`

#### Scenario: A file, not a folder
- **WHEN** the path is a file
- **THEN** the response is 400 with `Workspace path is not a directory: <path>` and `code` `workspace_not_directory`

#### Scenario: Generated output
- **WHEN** the path ends in `node_modules`, `graphify-out` or `.yodaman-doc-chunks`
- **THEN** the response is 400 with `Not a workspace: <name> is generated output` and `code` `workspace_generated`

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

### Requirement: Remove a workspace
`DELETE /api/projects` with body `{ path }` SHALL drop the path from `watchedDirectories`, add it to `removedDirectories`, save, stop its watcher and remove the ctx index registered for exactly that path. It MUST NOT remove an index found only by folder name or ancestor.

#### Scenario: Removed
- **WHEN** a client deletes a registered `/w/app` that ctx indexed
- **THEN** the system runs `ctx remove <index name>` and the response is 200 `{ "message": "Project removed", "path": "/w/app", "wasWatched": true, "ctxRemoved": true }`

#### Scenario: Namesake index
- **WHEN** ctx has no index for that exact path but has one for another folder named `app`
- **THEN** nothing is removed from ctx and `ctxRemoved` is false

#### Scenario: Stays removed
- **WHEN** the server restarts and ctx still lists the removed path
- **THEN** the startup sync does not add it back, and `GET /api/projects` does not list it

### Requirement: Indexing queue
The system SHALL index workspaces one at a time from a FIFO queue by spawning `ctx index <path> --name <name> --force --ignore <ignored list>`. A path already queued MUST NOT be queued twice. After a successful index it SHALL start an incremental Graphify build for the same path.

#### Scenario: Index run
- **WHEN** `/w/app` reaches the front of the queue
- **THEN** ctx runs with `--force`, so an already indexed project is re-indexed, and with `--ignore` set to the ignored directory names joined by commas
- **AND** `--name` is the index name the workspace already has, else its folder name when free, else the folder name plus `-` and the first 6 hex characters of the SHA-1 of the full path

#### Scenario: Success
- **WHEN** ctx exits 0
- **THEN** the cached ctx project list is dropped and `graphifyService.build(path, { update: true })` runs, logging `graphify_build_failed` if it fails

#### Scenario: Failure
- **WHEN** ctx exits non-zero
- **THEN** the system logs `index_failed` with `ctx index exited with code <code>` plus stderr, and moves on to the next queued path
- **AND** stdout text with a line starting `Error:` is logged as `ctx_index_reported_error`

#### Scenario: Missing folder
- **WHEN** the queued folder no longer exists
- **THEN** it is skipped with `index_skipped_workspace_missing`, and no Graphify build runs

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

### Requirement: Workspace index check
`GET /api/check?path=<path>` SHALL run `ctx check <name> --json` for the ctx project at that exact path and return its JSON plus `name` and `path`. It SHALL answer for folders ctx does not manage from the folder's existence alone.

#### Scenario: ctx project
- **WHEN** ctx lists a project at the path
- **THEN** the response is ctx's check result merged with `{ name, path }`

#### Scenario: Not managed by ctx
- **WHEN** ctx does not list the path and the folder exists
- **THEN** the response is `{ "status": "healthy", "name": <folder name>, "path", "ctxManaged": false }`
- **AND** a path that does not exist gets 404 `{ "error": "Path not found", "status": "missing" }`

#### Scenario: ctx fails
- **WHEN** a ctx call throws and the folder exists
- **THEN** the response is `{ "status": "healthy", "path", "ctxManaged": true, "note": <error> }`, otherwise 500 `{ "status": "error", "error" }`

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

### Requirement: File watching
The system SHALL watch every registered workspace with chokidar (depth 3, initial scan events ignored) and queue a reindex after changes settle. Ignored directories MUST NOT be watched. Each workspace SHALL have at most one watcher.

#### Scenario: Debounced reindex
- **WHEN** files change in a watched workspace
- **THEN** each change resets a per-workspace timer, and when it fires the workspace is queued for indexing
- **AND** the delay is `YODAMAN_WATCH_DEBOUNCE_MS`, default 1500 ms

#### Scenario: Ignored change
- **WHEN** a file changes under `node_modules/`, `graphify-out/` or any other ignored directory inside the workspace
- **THEN** it raises no event, and the watch root itself is never ignored

#### Scenario: Shutdown
- **WHEN** the server shuts down
- **THEN** the active `ctx index` process is killed, running ctx processes get SIGTERM, and all watchers and timers are closed

### Requirement: Startup sync
At startup the server SHALL watch each directory in `config.json` whether or not ctx works, then read `ctx list --json`, add, watch and queue every ctx project not removed or already watched, and save the config when it changed. A failure MUST be logged as `startup_sync_failed` and not stop the server. An unreadable `config.json` MUST NOT be overwritten.

#### Scenario: New ctx project found
- **WHEN** ctx lists `/w/other`, which is neither watched nor removed
- **THEN** it is added and saved, `config_synced_from_ctx` is logged, and it is queued for indexing and a Graphify update

#### Scenario: Counts for health
- **WHEN** the sync finishes
- **THEN** the health state records `projects` (watched count) and `indexed` (watched paths ctx lists) and sets `syncComplete` to true

#### Scenario: ctx unavailable
- **WHEN** `ctx list` fails at startup
- **THEN** `startup_sync_failed` is logged and every registered workspace is still watched

### Requirement: One ignore list
The directories never watched, never indexed and never scanned for freshness SHALL come from `IGNORED_DIRECTORIES` in `shared/ignoredPaths.js`. A path MUST be ignored when any segment names an ignored directory. `bin`, `packages` and `target` MUST NOT be on the list.

#### Scenario: The list
- **WHEN** the list is read
- **THEN** it is `.git`, `node_modules`, `dist`, `build`, `release`, `coverage`, `graphify-out`, `.yodaman-doc-chunks`, `.yodaman-approval-smoke`, `obj`, `.vs`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.venv`, `venv`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `.cache`, `vendor`, `third_party`, `bower_components`, `Pods`, `.gradle` and `.terraform`

#### Scenario: Segment match
- **WHEN** `isIgnoredPath("src/node_modules/x.js")` is called
- **THEN** it returns true, and `isIgnoredPath("")` returns false

### Requirement: Generated and user-owned paths
`shared/generatedPaths.js` SHALL name the folders YodaMan creates in a workspace (`.yodaman-doc-chunks` and `graphify-out`), the home state folder `.yodaman`, and the user-owned folder `openspec`. `openspec` MUST never be treated as generated or removable.

#### Scenario: Removable folders
- **WHEN** a caller reads `GENERATED_WORKSPACE_DIRS`
- **THEN** it is `[".yodaman-doc-chunks", "graphify-out"]`

#### Scenario: User-owned folder
- **WHEN** `isUserOwned("openspec")` is called
- **THEN** it returns true

### Requirement: Files that still exist
Search hits and graph nodes that name a file SHALL be kept only while the file exists, using `workspaceFileExists(project, file)` from `shared/workspaceFiles.js`. An empty file name, or a relative file with no project, MUST count as existing.

#### Scenario: Relative and absolute
- **WHEN** a relative file is checked against a project
- **THEN** it exists when `<project>/<file>` exists
- **AND** an absolute file is checked as given
