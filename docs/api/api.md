# YodaMan API Reference

All API endpoints are prefixed with `/api`.

## Project Management

### `GET /projects`
Returns a list of all indexed workspaces and watched directories.

**Response:**
```json
[
  {
    "id": "project-path",
    "name": "project-name",
    "path": "/absolute/path/to/project",
    "files": 42,
    "chunks": 150,
    "indexed": true
  }
]
```

### `POST /projects`
Adds a new directory to the watched list and triggers initial indexing.

**Body:** `{ "path": "/path/to/dir" }`

### `DELETE /projects`
Removes a directory from the watched list.

**Body:** `{ "path": "/path/to/dir" }`

### `PUT /projects`
Moves a watched project to a new path. The watcher and index are transferred; the old path is cleaned up.

**Body:** `{ "path": "/old/path", "nextPath": "/new/path" }`

**Response:**
```json
{
  "message": "Project path updated",
  "path": "/new/path",
  "previousPath": "/old/path"
}
```

## Intelligence & AI

### `POST /ask`
Queries the AI engine about the current project context. When `projectId` resolves to a workspace path, YodaMan injects Graphify graph report context and question-specific graph traversal output before calling Context Expert.

**Body:** `{ "question": "What does the auth service do?", "projectId": "/absolute/path/to/project" }`
**Response:** `{ "answer": "The auth service handles..." }`

### `POST /agent/task`
Starts an autonomous agent task. The agent loads the default coding skill, receives Graphify graph context when a workspace is provided, and streams progress over **Server-Sent Events (SSE)**.

**Body:** `{ "task": "Implement a login form", "projectId": "/path/to/project", "fileIds": ["abc123"] }`
**Events:**
- `data: {"type": "task_started", "taskId": "abc123", "projectId": "/path/to/project"}`
- `data: {"type": "tool_start", "tool": "searchCode", "params": {...}}`
- `data: {"type": "tool_end", "tool": "searchCode", "result": {...}}`
- `data: {"type": "awaiting_approval", "taskId": "abc123", "tool": "writeFile", "params": {...}}`
- `data: {"type": "final_answer", "answer": "I have created the login form..."}`
- `data: {"type": "task_cancelled", "taskId": "abc123", "message": "Task cancelled."}`
- `data: {"type": "error", "taskId": "abc123", "message": "..."}`
- `data: {"type": "upload_error", "fileId": "abc123", "message": "..."}`

### `POST /agent/approve`
Approves or rejects an agent write request.

**Body:** `{ "taskId": "abc123", "approved": true }`
**Response:** `{ "message": "Signal sent" }`

### `POST /agent/cancel`
Requests cancellation of an active agent task.

**Body:** `{ "taskId": "abc123" }`
**Response:** `{ "message": "Cancellation requested", "taskId": "abc123" }`

### `GET /agent/tasks`
Returns recent persisted agent task state for external clients. Task history is retained locally in `task-history.json` and appended to `task-history.jsonl`.

### `GET /agent/tasks/:taskId/events`
Returns recent persisted task events for a specific agent task.

### `GET /agent/pending-approvals`
Returns active write approvals that are waiting for a human decision.

### `DELETE /agent/tasks`
Clears all persisted agent task history.

**Response:** `{ "message": "Task history cleared" }`

### `GET /search`
Unified semantic search that always returns both code and documentation results. Results are graph-ranked when a project is provided.

**Query Params:** `query`, `project` (optional), `top` (default: 15), `activeFile` (optional — used by GraphRanker to bias results)

**Response:**
```json
{
  "results": [
    {
      "_source": "code",
      "specFlag": { "covered": true, "specs": ["auth-spec", "api-design"] }
    },
    {
      "_source": "docs",
      "specFlag": { "covered": false }
    }
  ],
  "graphRanked": true,
  "weights": {
    "semantic": 0.50,
    "proximity": 0.20,
    "centrality": 0.15,
    "specCoverage": 0.15
  },
  "activeFile": "src/auth.js"
}
```

## Sessions

Session storage persists chat and agent conversation history per project.

### `GET /sessions`
Returns all stored messages for a project.

**Query Params:** `projectId` (required)

**Response:**
```json
[
  { "role": "user", "content": "What does the auth service do?", "timestamp": "2025-01-15T10:30:00Z" },
  { "role": "ai", "content": "The auth service handles...", "timestamp": "2025-01-15T10:30:05Z" }
]
```

### `DELETE /sessions`
Clears all stored messages for a project.

**Query Params:** `projectId` (required)

**Response:** `{ "message": "Session cleared" }`

## Git API

Git endpoints provide workspace-level version control from the UI. All paths must resolve to an accessible directory.

### `GET /git/context`
Returns a compact git status snapshot: current branch, ahead/behind counts, and the 8 most recent commits.

**Query Params:** `path` (required — workspace directory)

**Response:**
```json
{
  "branch": "main",
  "ahead": 2,
  "behind": 0,
  "recentCommits": [
    { "hash": "a1b2c3d", "subject": "Add login form", "relativeTime": "2 hours ago" }
  ]
}
```

### `GET /git/history`
Returns paginated commit history for a workspace, optionally filtered to a single file.

**Query Params:** `path` (required), `file` (optional), `limit` (default: 100, max: 500)

**Response:**
```json
{
  "commits": [
    { "hash": "a1b2c3d", "subject": "...", "author": "...", "date": "...", "body": "..." }
  ]
}
```

### `GET /git/heatmap`
Returns per-file change-frequency data for heatmap visualisations.

**Query Params:** `path` (required)

**Response:**
```json
{
  "files": [
    { "path": "src/auth.js", "changes": 42, "lastModified": "2025-01-15" }
  ]
}
```

### `GET /git/branch`
Returns detailed branch information for a workspace.

**Query Params:** `path` (required)

**Response:** `{ "current": "main", "branches": ["main", "feature/login"], ... }`

### `GET /git/commit`
Returns detailed information for a specific commit.

**Query Params:** `path` (required), `hash` (required — full or abbreviated commit hash)

**Response:**
```json
{
  "hash": "a1b2c3d",
  "author": "Jane Doe",
  "date": "2025-01-15T10:30:00Z",
  "message": "Add login form",
  "files": [
    { "filePath": "src/auth.js", "additions": 42, "deletions": 5 },
    { "filePath": "src/login.js", "additions": 120, "deletions": 0 }
  ]
}
```

### `POST /git/commit`
Stages files and creates a commit. Falls back to `--allow-empty` when there is nothing to commit.

**Body:** `{ "path": "/path/to/workspace", "message": "feat: add login", "files": ["src/auth.js"] }`

**Response:**
```json
{
  "ok": true,
  "branch": "main",
  "hash": "a1b2c3d"
}
```

### `POST /git/push`
Pushes the current branch to its upstream remote.

**Body:** `{ "path": "/path/to/workspace" }`

**Response:**
```json
{
  "ok": true,
  "output": "Everything up-to-date"
}
```

### `POST /git/pull`
Pulls from the upstream remote with `--rebase`.

**Body:** `{ "path": "/path/to/workspace" }`

**Response:**
```json
{
  "ok": true,
  "output": "Already up to date."
}
```

### `POST /git/branch`
Creates and checks out a new branch.

**Body:** `{ "path": "/path/to/workspace", "branch": "feature/new-stuff" }`

**Response:**
```json
{
  "ok": true,
  "branch": "feature/new-stuff"
}
```

## Plugins API

Plugin management covers listing, uploading, deleting, opening, enabling, and disabling plugins. Plugin uploads are disabled by default; enable them with `YODAMAN_ALLOW_PLUGIN_UPLOADS=true` (local trusted sessions only). Default plugins (`graphify`, `Grand-Inquisitor`, `CodeTrooper`, `Droid-Sweep`, `lightsaber`) cannot be deleted or disabled.

### `GET /plugins`
Lists all loaded plugins with name, description, parameters, and permissions.

**Response:**
```json
[
  {
    "name": "Grand-Inquisitor",
    "description": "Code review plugin",
    "parameters": { "...": "..." },
    "permissions": ["unrestricted"],
    "restricted": false
  }
]
```

### `POST /plugins`
Uploads a new plugin file (`.js` or `.zip`). Zip archives are extracted; `plugin.json` permissions inside the archive are merged into the plugin. Requires `allowPluginUploads` to be enabled.

**Body:** multipart/form-data with field `plugin` (the file).

**Response:**
```json
{
  "message": "Plugin uploaded and loaded",
  "name": "my-plugin.js"
}
```

### `DELETE /plugins/:name`
Removes a plugin from disk. Default plugins are protected and return 403.

**Response:** `{ "message": "Plugin deleted" }`

### `GET /plugins/:name/status`
Returns whether a plugin is loaded, enabled, or disabled.

**Response:**
```json
{
  "name": "Grand-Inquisitor",
  "loaded": true,
  "enabled": true,
  "disabled": false
}
```

### `POST /plugins/:name/open`
Invokes the plugin's `open` action, typically to launch its viewer or UI surface.

**Body:** `{ "project": "/path/to/workspace", "diagnostics": {...} }` (optional)

**Response:**
```json
{
  "ok": true,
  "name": "Grand-Inquisitor",
  "project": "/path/to/workspace",
  "result": { "opened": true, "url": "http://..." }
}
```

### `POST /plugins/:name/enable`
Re-enables a previously disabled plugin.

**Response:** `{ "message": "Plugin Grand-Inquisitor enabled", "name": "Grand-Inquisitor", "enabled": true }`

### `POST /plugins/:name/disable`
Disables a plugin without removing its file. Default plugins are protected and return 403.

**Response:** `{ "message": "Plugin my-plugin disabled", "name": "my-plugin", "disabled": true }`

## Graphify

Graphify is a required knowledge graph layer in YodaMan 0.4.8. The runtime fails startup when the `graphify` CLI cannot be found. Graphify endpoints require a registered workspace path.

### `GET /graphify/status`
Returns graph availability, artifact health, stale status, and the last persisted build summary. Large graphs can return `build.state: "partial"` when `graph.json` and the report exist but full HTML artifacts were skipped.

**Query Params:** `path`

### `POST /graphify/build`
Queues a workspace graph build and returns immediately with a build job id.

**Body:** `{ "path": "/absolute/path/to/project" }`

### `GET /graphify/build/status`
Returns the in-memory build job state, the last persisted build summary, and graph freshness.

**Query Params:** `path`, `jobId` (optional)

### `GET /graphify/artifact`

Serves a generated Graphify HTML artifact for a registered workspace. Query parameters:

- `path`: absolute registered workspace path.
- `type`: `mindmap` for `graph.html` or `visualizer` for `graph_visualizer.html`.

The route only serves known Graphify artifacts from the workspace's `graphify-out/` directory.

### `GET /graphify/report`

Returns the Graphify markdown report for a registered workspace.

**Query Params:** `path`

### `POST /graphify/query`
Runs a natural-language graph traversal query.

**Body:** `{ "path": "/absolute/path/to/project", "query": "How does auth connect to sessions?" }`

### `POST /graphify/explain`
Explains a node and its neighboring graph context.

**Body:** `{ "path": "/absolute/path/to/project", "node": "AuthService" }`

### `POST /graphify/path`
Finds a graph path between two entities.

**Body:** `{ "path": "/absolute/path/to/project", "source": "LoginForm", "target": "SessionStore" }`

### `POST /graphify/affected`
Runs impact analysis for a node by reverse-traversing related graph edges.

**Body:** `{ "path": "/absolute/path/to/project", "node": "AuthService", "depth": 3, "relations": [] }`

### `GET /graphify/map`
Returns a compact graph summary for architecture map views.

**Query Params:** `path`, `limit` (default: 80)

### `POST /graphify/tree`
Generates Graphify's D3 collapsible tree HTML artifact.

**Body:** `{ "path": "/absolute/path/to/project" }`

## Stardust API

Stardust wraps the OpenSpec CLI for spec-driven development. It compares intended architecture (OpenSpec specs) against actual structure (Graphify knowledge graph) to detect drift, supply graph-grounded authoring context, and run spec workflows.

### `GET /stardust/drift`
Diffs OpenSpec specs against the Graphify knowledge graph. Flags specs that cite files that no longer exist, and load-bearing modules that no spec describes.

**Query Params:** `projectRoot` (defaults to `cwd`), `minDependents` (default: 2)

**Response:**
```json
{
  "available": true,
  "orphanedSpecs": [],
  "undocumentedModules": ["src/new-auth.js"],
  "summary": "1 undocumented module, 0 orphaned specs"
}
```

### `GET /stardust/context`
Supplies graph-grounded context for authoring a change proposal. For each file in the change, returns its blast radius, covering tests, risk level, and top dependents — plus the architectural hubs in the workspace. Requires a built Graphify graph.

**Query Params:** `projectRoot` (defaults to `cwd`), `files` (comma-separated, max 25)

**Response:**
```json
{
  "available": true,
  "projectRoot": "/path/to/project",
  "graph": { "files": 200, "nodes": 1500, "links": 3200 },
  "architecturalHubs": ["src/app.js", "src/auth.js"],
  "targets": [
    {
      "file": "src/auth.js",
      "inGraph": true,
      "impactedCount": 12,
      "coveringTests": ["test/auth.test.js"],
      "risk": "high",
      "dependents": ["src/login.js", "src/session.js"],
      "summary": "12 dependents · high risk · 1 covering test"
    }
  ]
}
```

### `GET /stardust/diagnose`
Runs the OpenSpec diagnose command to surface environment and configuration issues.

**Query Params:** `projectRoot` (defaults to `cwd`)

**Response:** (OpenSpec diagnose output — structure varies by OpenSpec version)

### `POST /stardust/run`
Executes an arbitrary OpenSpec CLI action. Supported actions: `diagnose`, `validate`, `archive`, `list`, `init`, `install`, `propose`.

`propose` creates a new change directory under `openspec/changes/<changeId>/` with `proposal.md`, `design.md`, and `tasks.md`. Existing files are not overwritten — the response reports what was created vs already existed.

**Body:**
```json
{
  "action": "validate",
  "changeId": "add-login",
  "projectRoot": "/path/to/project",
  "dryRun": false
}
```

**Response:**
```json
{
  "success": true,
  "stdout": "...",
  "stderr": "",
  "exitCode": 0
}
```

### `GET /stardust/board`
Returns a real-time change-board snapshot. This is the REST fallback for the WebSocket `/api/stardust/live` feed — the UI seeds from this endpoint before upgrading to live updates.

**Query Params:** `projectRoot` (default: server CWD)

**Response:**
```json
{
  "changes": [
    {
      "name": "add-auth-middleware",
      "status": "proposed",
      "taskCompleted": 2,
      "taskTotal": 5,
      "validation": "ok",
      "mtimeMs": 1722672000000
    }
  ],
  "ready": true,
  "graphStatus": "current"
}
```

### `GET /stardust/deltas/:name`
Returns operation-grouped spec deltas for a change. Parses `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` sections from spec files under `openspec/changes/<name>/specs/`.

**Query Params:** `projectRoot` (default: server CWD)

**Response:**
```json
{
  "change": "add-auth-middleware",
  "deltas": [
    {
      "op": "ADDED",
      "requirement": "Login endpoint",
      "body": "The system shall provide a POST /login endpoint.",
      "specId": "auth"
    }
  ]
}
```

### `PUT /stardust/validation/:name`
Stores the last validation result for a change so the change board can show health icons.

**Body:** `{ "status": "ok" | "warn" | "error" }`

### `WS /api/stardust/live`
WebSocket endpoint for real-time OpenSpec dashboard updates. Pushes `snapshot` messages (full board state) on connect and on every file change, and `activity` messages for individual file events. Query with `?projectRoot=<path>` to watch a specific workspace.

**Message types:**
- `{ "type": "snapshot", "data": { "changes": [...], "ready": true, "graphStatus": "current" } }`
- `{ "type": "activity", "data": { "event": "modified", "path": "changes/add-login/tasks.md", "detail": "tasks.md was modified", "timestamp": 1722672000000 } }`

### `GET /stardust/compose`
File-centric cross-reference aggregating data from all three mandatory tools for a single file. Returns which OpenSpec specs mention it, its Graphify structural metrics (dependents, centrality, blast radius, test coverage), and Context Expert ranking context with actual neighbour details.

**Query Params:** `projectRoot`, `file` (repo-relative path, required), `depth` (default: 2, range: 1–4), `limit` (default: 5)

**Response:**
```json
{
  "file": "backend/interfaces/RestController.js",
  "available": true,
  "openspec": { "mentionedIn": [{ "spec": "api-design", "file": "..." }], "specCount": 3 },
  "graphify": { "dependents": 12, "centrality": 45, "blastRadius": 5, "nearestDependents": [...], "coveredByTests": true, "testFiles": [...] },
  "contextExpert": {
    "neighbours": [
      { "file": "backend/services/AuthService.js", "similarity": 0.92, "source": "code" },
      { "file": "docs/api-design.md", "similarity": 0.87, "source": "docs" }
    ]
  }
}
```

### `GET /stardust/spec`
Returns the current text of a published spec by ID. Used by the SpecDiff side-by-side view as its left-hand "current" column.

**Query Params:** `projectRoot`, `spec` (spec ID, e.g. `auth`)

### `GET /stardust/change-impact/:name`
Resolves every file a change's spec deltas cite against the knowledge graph. Returns per-file blast radius, risk level, test coverage, and staleness. Includes aggregated totals (`untested`, `highestRisk`).

**Query Params:** `projectRoot`

## Health & Readiness

### `GET /health`
Returns a full health report for all runtime dependencies. Polled by the Electron diagnostics page on load.

Checks include `node`, `runtime`, `graphify`, `ollama`, `ctx`, `openspec`, and `config`. Each check reports `ok`, `version`, and a human-readable `message`. The top-level `status` is `starting`, `ok`, or `degraded`; `degraded` and `pending` arrays name checks that need attention (without repeating success or pending reports).

**Response:**
```json
{
  "status": "ok",
  "started": true,
  "uptimeSeconds": 3600,
  "checks": {
    "node": { "ok": true, "version": "v20.0.0", "message": "v20.0.0 on darwin arm64" },
    "runtime": { "ok": true, "version": null, "message": "PID 12345, listening on port 3090" },
    "graphify": { "ok": true, "version": "1.2.0", "message": "ready" },
    "ollama": { "ok": true, "version": "0.1.0", "message": "ready" },
    "ctx": { "ok": true, "version": "2.1.0", "message": "ready" },
    "openspec": { "ok": true, "version": "0.5.0", "message": "ready" },
    "config": { "ok": true, "version": null, "message": "config valid" }
  },
  "degraded": [],
  "pending": [],
  "services": { "ollama": { "running": true } },
  "projects": { "total": 3, "indexed": 3, "synced": true },
  "readiness": { "/path/to/project": { "ready": true, "reason": "..." } },
  "memory": { "rss": 123456789, "heapTotal": 98765432, "heapUsed": 54321098, "external": 1234567, "arrayBuffers": 12345 },
  "platform": { "hostname": "machine", "release": "23.0.0", "arch": "arm64" },
  "tasks": { "total": 3, "pendingApprovals": 1 },
  "plugins": []
}
```

### `POST /health/install`
Attempts to self-heal a missing dependency by running its install command. Returns **403** with code `self_heal_install_disabled` unless `allowSelfHealInstall` is enabled in settings.

**Body:** `{ "component": "ollama" }` — supported values: `ollama`, `ctx`, `openspec`

**Success Response:**
```json
{
  "ok": true,
  "component": "ollama",
  "message": "Ollama installed. Restart the runtime."
}
```

**Error Response (403):**
```json
{
  "ok": false,
  "code": "self_heal_install_disabled",
  "message": "Self-heal install is disabled. Enable allowSelfHealInstall in settings."
}
```

### `GET /readiness`
Collapses Context Expert index state and Graphify build state into a single trust verdict per workspace, so a client never has to reconcile them itself. Returns readiness for every watched workspace, or a single one when `projectId` is given.

**Query Params:** `projectId` (optional — absolute path)

**Response:**
```json
{
  "/path/to/project": { "ready": true, "reason": "indexed and graph up to date" }
}
```

## System

### `GET /status`
Returns Context Expert telemetry: CLI version, database stats, embedding provider, and LLM configuration.

Responses include an `X-Request-Id` header. Runtime logs include the same request ID for incident correlation.

**Response:**
```json
{
  "version": "2.1.0",
  "nodeVersion": "v20.0.0",
  "platform": "darwin",
  "database": { "sizeFormatted": "12.3 MB", "path": "/path/to/ctx/db" },
  "totalChunks": 15000,
  "projects": 3,
  "embedding": { "provider": "ollama", "model": "nomic-embed-text" },
  "llm": { "model": "llama3", "provider": "ollama" },
  "ok": true
}
```

When Context Expert is unavailable the response degrades gracefully:
```json
{
  "version": "ctx-unavailable",
  "nodeVersion": "v20.0.0",
  "platform": "darwin",
  "database": { "sizeFormatted": "—", "path": "—" },
  "totalChunks": 0,
  "projects": 0,
  "embedding": { "provider": "—", "model": "—" },
  "llm": { "model": "Not Available", "provider": "none" },
  "ok": false,
  "error": "spawn ctx ENOENT",
  "hint": "Install ctx: npm install -g @contextexpert/cli"
}
```

### `GET /policy`
Returns runtime safety policy details, including allowed workspace roots, blocked command patterns, and plugin permissions.

### `GET /audit`
Returns recent tool audit log entries.

**Query Params:** `limit` (default: 100)

Audit entries are retained in `audit-log.json` and appended to `audit-log.jsonl`.

### `DELETE /audit`
Clears all persisted audit log entries.

**Response:** `{ "message": "Audit logs cleared" }`

### `GET /desktop/diagnostics`
Returns desktop/runtime diagnostics for control surfaces, including runtime telemetry, host info, task counts, plugin list, and dependency health states.

### `GET /logs`
Returns recent structured runtime logs plus index queue state.

Optional query filters:

- `limit`: Maximum entries to return.
- `level`: `error`, `warn`, or `info`.
- `severity`: `critical`, `high`, `medium`, or `low`.
- `query`: Case-insensitive search across message, metadata, and stack traces.
- `userAction`: Source workflow such as `code_search`, `agent_tool_call`, `chat_ask`, or `startup`.
- `message`: Exact log message key.
- `since` / `until`: ISO timestamps for time-window filtering.

### `POST /logs/client-error`
Records a frontend-side failure in the same live log stream. Use this for UI catches that would otherwise only appear in the browser console.

Body fields:

- `message`: Error message.
- `stack`: Optional client stack trace.
- `userAction`: Workflow such as `code_search`, `chat_ask`, or `agent_task`.
- `component`: UI component or client surface.
- `severity`: `critical`, `high`, `medium`, or `low`.
- `context`: Small structured object with query, project, mode, or other reproduction context.

### `GET /check`
Runs a health check on a specific workspace path via Context Expert.

**Query Params:** `path` (required)

### `POST /reindex`
Manually queues a workspace for re-indexing.

**Body:** `{ "path": "/path/to/workspace" }`

## Settings & CTX Config

### `GET /settings`
Returns all runtime settings (plugin uploads, unrestricted plugins, agent commands, pairing token requirement).

**Response:**
```json
{
  "allowPluginUploads": false,
  "allowUnrestrictedPlugins": false,
  "allowAgentCommands": true,
  "requirePairingToken": false
}
```

### `PUT /settings`
Updates one or more runtime settings. Accepted keys: `allowPluginUploads`, `allowUnrestrictedPlugins`, `allowAgentCommands`, `requirePairingToken`, `allowSelfHealInstall`, `allowedCommands`. Boolean keys are coerced to boolean. Plugin permissions are reloaded immediately after a save.

**Body:** `{ "allowPluginUploads": true, "requirePairingToken": true }`

**Response:** (same shape as `GET /settings`, reflecting the new state)

### `GET /ctx/config`
Lists all Context Expert CLI configuration values.

**Response:**
```json
{
  "ok": true,
  "config": { "model": "llama3", "embedding_model": "nomic-embed-text", "..." : "..." }
}
```

### `POST /ctx/config`
Sets a single Context Expert configuration key.

**Body:** `{ "key": "model", "value": "llama3" }`

**Response:**
```json
{
  "ok": true,
  "key": "model",
  "value": "llama3"
}
```

## Pairing

### `POST /pairing`
Creates a temporary mobile pairing payload.

**Body:** `{ "runtimeUrl": "http://192.168.1.20:3090" }` (optional)
**Response:** `{ "runtimeUrl": "...", "token": "...", "expiresAt": "...", "link": "yodaman://pair?..." }`

### `GET /pairing`
Lists active pairing token metadata.

### `POST /pairing/revoke`
Revokes a pairing token.

**Body:** `{ "token": "..." }`
**Response:** `{ "revoked": true }`

## File Upload

File uploads are handled by a dedicated sub-router (`fileUploadService.router`). Routes under `/api/upload` accept multipart file uploads and manage temporary file storage for agent tasks. Allowed extensions: `.dart`, `.js`, `.ts`, `.json`, `.yaml`, `.md`, `.log`, `.txt`. Maximum file size: 5 MB. Temp files expire after 60 minutes.

### `POST /upload/temp`
Uploads a single file to temporary storage. Returns a `fileId` used to attach the file to an agent task.

**Body:** multipart/form-data with field `file`.

**Response:**
```json
{
  "fileId": "abc123-uuid",
  "filename": "auth.js",
  "size": 2048,
  "type": "application/javascript",
  "taskId": null
}
```

### `POST /upload/attach`
Moves a temporary file into a task's persistent storage, associating it with the given `taskId`.

**Body:** `{ "taskId": "agent-task-123", "fileId": "abc123-uuid" }`

**Response:**
```json
{
  "fileId": "abc123-uuid",
  "filename": "auth.js",
  "size": 2048,
  "type": "application/javascript",
  "taskId": "agent-task-123"
}
```

### `DELETE /upload/temp/:fileId`
Deletes a temporary file by id.

**Response:** `{ "deleted": true }`

### `GET /upload/task/:taskId/files`
Lists all files attached to a task.

**Response:**
```json
{
  "files": [
    {
      "fileId": "abc123-uuid",
      "filename": "auth.js",
      "size": 2048,
      "type": "application/javascript",
      "taskId": "agent-task-123"
    }
  ]
}
```

Uploaded files can also be attached directly to agent tasks via the `fileIds` array in `POST /agent/task`.
