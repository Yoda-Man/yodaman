# YodaMan API Reference

All API endpoints are prefixed with `/api`. Every response carries an
`X-Request-Id` header (a client may send its own), and runtime log entries for
the request include the same ID.

Other agents can reach the read paths without HTTP: `yodaman-mcp` exposes
search, graph queries, impact and spec drift over MCP's stdio transport,
proxying the routes below. See [MCP](../guides/mcp.md). Writes are deliberately
absent from that surface — they are available here, behind the approval gate.

## Access

- Browser requests from another site are rejected before any route runs
  (OriginPolicy). Requests from this computer are trusted.
- When `requirePairingToken` is on (the default), a request from another
  machine must send a valid pairing token in `X-YodaMan-Token`. See
  [Pairing](#pairing).
- Some actions only work from this computer whatever the token: pairing,
  changing settings, Context Expert and Ollama configuration, opening files in
  the editor, the editor picker, and Repair.

Errors are JSON of the form `{ "error": "...", "code": "..." }` unless noted.

## Project Management

### `GET /projects`
Returns every indexed workspace from Context Expert, merged with watched
directories that are not indexed yet. Removed and generated temporary
workspaces are left out. If Context Expert cannot be reached, the watched
directories are returned with `indexed: false`.

**Response:**
```json
[
  {
    "name": "project-name",
    "indexName": "project-name-bbc91a",
    "path": "/absolute/path/to/project",
    "id": "/absolute/path/to/project",
    "files": 42,
    "chunks": 150,
    "indexed": true
  }
]
```

`name` is the folder name; `indexName` is Context Expert's index key. Watched
directories that are not indexed have no `indexName`.

### `POST /projects`
Adds a directory to the watched list, starts watching it, and queues it for
indexing.

**Body:** `{ "path": "/path/to/dir" }`
**Response:** `201 { "message": "Project added", "path": "/path/to/dir" }`, or
`200 { "message": "Already exists" }`.

### `DELETE /projects`
Removes a directory from the watched list, stops watching it, and removes it
from the Context Expert index.

**Body:** `{ "path": "/path/to/dir" }`
**Response:** `{ "message": "Project removed", "path": "...", "wasWatched": true, "ctxRemoved": true }`

### `PUT /projects`
Moves a watched project to a new path. The old path is unwatched and removed
from the index; the new path is watched and queued for indexing.

**Body:** `{ "path": "/old/path", "nextPath": "/new/path" }`

**Response:**
```json
{
  "message": "Project path updated",
  "path": "/new/path",
  "previousPath": "/old/path"
}
```

Returns `404` (`project_not_found`) if `path` is not watched, and `409`
(`project_exists`) if `nextPath` already is.

## Intelligence & AI

### `POST /ask`
Answers a question about a workspace. When `projectId` resolves to a workspace,
YodaMan adds the Graphify report and a question-specific graph traversal to the
question before passing it to Context Expert (`ctx ask`). If Context Expert
fails or takes longer than `YODAMAN_CTX_ASK_TIMEOUT_MS` (default 12000 ms),
no model answers: the reply says so and returns the graph context and the top
five search-pipeline matches instead.
The question and answer are saved to the workspace's session and to its graph.

**Body:** `{ "question": "What does the auth service do?", "projectId": "/absolute/path/to/project" }`
**Response:** `{ "answer": "The auth service handles..." }`

### `POST /agent/task`
Starts an agent task. The agent's system prompt includes the default coding
skill, and graph context when a workspace is given. Progress streams back as
**Server-Sent Events**; every event carries the `taskId`.

**Body:** `{ "task": "Implement a login form", "projectId": "/path/to/project", "fileIds": ["abc123"] }`
(`fileIds`: up to 20 uploaded temp files, see [File Upload](#file-upload))

**Events:**
- `data: {"type": "task_started", "taskId": "abc123", "projectId": "/path/to/project"}`
- `data: {"type": "tool_start", "taskId": "abc123", "tool": "searchCode", "params": {...}}`
- `data: {"type": "tool_end", "taskId": "abc123", "tool": "searchCode", "result": {...}}`
- `data: {"type": "awaiting_approval", "taskId": "abc123", "tool": "writeFile", "params": {...}, "impact": {...}, "specImpact": {...}}`
- `data: {"type": "response_truncated", "taskId": "abc123", "iteration": 2, "message": "..."}`
- `data: {"type": "final_answer", "taskId": "abc123", "answer": "I have created the login form..."}`
- `data: {"type": "task_cancelled", "taskId": "abc123", "message": "Task cancelled."}`
- `data: {"type": "error", "taskId": "abc123", "message": "..."}`
- `data: {"type": "upload_error", "taskId": "abc123", "fileId": "abc123", "message": "..."}`

### `POST /agent/approve`
Approves or rejects a pending agent write.

**Body:** `{ "taskId": "abc123", "approved": true }`
**Response:** `{ "message": "Signal sent" }`

### `POST /agent/cancel`
Requests cancellation of an active agent task.

**Body:** `{ "taskId": "abc123" }`
**Response:** `{ "message": "Cancellation requested", "taskId": "abc123" }`

### `GET /agent/tasks`
Returns recent agent tasks, newest first. Task history is stored in
`yodaman.db` in the YodaMan data folder (`task-history.json` and
`task-history.jsonl` in the same folder are used only if the database cannot be
opened).

### `GET /agent/tasks/:taskId/events`
Returns the recorded events for one agent task.

### `GET /agent/pending-approvals`
Returns writes waiting for a human decision:
`[{ "taskId", "task", "projectId", "createdAt", "updatedAt", "approval" }]`.

### `DELETE /agent/tasks`
Clears all agent task history.

**Response:** `{ "message": "Task history cleared" }`

## Search

Every search endpoint runs the search pipeline: Context Expert retrieves,
missing and generated files and duplicates are dropped, Graphify ranks, and
OpenSpec tags each result.

### `GET /search`
Code and documentation together.

**Query Params:** `query` (required), `project` (optional), `top` (default 15, max 50), `activeFile` (optional — lets graph proximity count in the ranking)

**Response:**
```json
{
  "results": [
    {
      "_source": "code",
      "graphSignal": { "...": "..." },
      "graphRank": 0.8123,
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
  "activeFile": "src/auth.js",
  "pillars": { "contextExpert": true, "graphify": true, "openspec": true },
  "dropped": { "generated": 0, "missing": 0, "duplicates": 1 }
}
```

Each result also keeps Context Expert's own fields for the hit. `graphSignal`
and `graphRank` are present only when Graphify ranked the results, and
`specFlag` only when the workspace has specs. `pillars` says which of the three
actually contributed. A `project` whose folder no longer exists returns `404`
(`workspace_missing`).

### `GET /search/code` and `GET /search/docs`
The same, restricted to code or to documentation. Same query params; `top`
defaults to 10. The response adds `"mode": "code"` or `"mode": "doc"`.

### `GET /search/stream`
The Search view's search, as Server-Sent Events: the results as soon as they
exist, then the local model's summary of those results. Same query params as
`GET /search`.

**Events:** `results` (the `GET /search` response), `summary_start`
(`{ "model": "..." }`), `summary` (`{ "text": "..." }`, repeated),
`summary_error`, `search_error`, `done`. Closing the connection stops the model.

## Sessions

Session storage keeps chat and agent conversation history per project.

### `GET /sessions`
Returns all stored messages for a project.

**Query Params:** `projectId` (required)

**Response:**
```json
[
  { "role": "user", "content": "What does the auth service do?", "timestamp": "2026-01-15T10:30:00Z" },
  { "role": "ai", "content": "The auth service handles...", "timestamp": "2026-01-15T10:30:05Z" }
]
```

Agent answers also carry `"isAgent": true` and the task's `steps`.

### `DELETE /sessions`
Clears all stored messages for a project.

**Query Params:** `projectId` (required)

**Response:** `{ "message": "Session cleared" }`

## Git API

Git endpoints run `git` in the given workspace directory, without a shell.

### `GET /git/context`
A compact status snapshot: current branch, ahead/behind counts, and the 8 most
recent commits. If git fails, it still answers `200` with `branch: "Unavailable"`
and an `error`.

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
Commit history for a workspace, optionally for a single file inside it.

**Query Params:** `path` (required), `file` (optional), `limit` (default: 100, max: 500)

**Response:**
```json
{
  "commits": [
    { "hash": "<full hash>", "author": "Jane Doe", "date": "2026-01-15T10:30:00.000Z", "message": "Add login form", "filesChanged": 3 }
  ]
}
```

### `GET /git/heatmap`
Per-file change counts over the last 30 days, most-changed first.

**Query Params:** `path` (required)

**Response:**
```json
{
  "files": [
    { "filePath": "src/auth.js", "changeCount": 42, "lastChangeDate": "2026-01-15T10:30:00.000Z", "authorCount": 2 }
  ]
}
```

### `GET /git/timeline`
Commits and the files each touched, oldest first, for Holocron's time slider.
Limited to the workspace folder and to at most 3000 commits.

**Query Params:** `path` (required), `days` (default: 365, max: 3650)

**Response:**
```json
{
  "commits": [
    { "hash": "a1b2c3d4e5", "author": "Jane Doe", "date": "2026-01-15T10:30:00.000Z", "files": [{ "path": "src/auth.js", "status": "M" }] }
  ],
  "truncated": false
}
```

### `GET /git/branch`
Branch information for a workspace.

**Query Params:** `path` (required)

**Response:**
```json
{
  "currentBranch": "main",
  "branches": ["main", "feature/login"],
  "ahead": 0,
  "behind": 0,
  "latestCommit": { "hash": "<full hash>", "author": "Jane Doe", "date": "...", "message": "Add login form" }
}
```

### `GET /git/commit`
Details for one commit.

**Query Params:** `path` (required), `hash` (required — 7 to 40 hex characters)

**Response:**
```json
{
  "hash": "<full hash>",
  "author": "Jane Doe",
  "date": "2026-01-15T10:30:00.000Z",
  "message": "Add login form",
  "files": [
    { "filePath": "src/auth.js", "additions": 42, "deletions": 5 },
    { "filePath": "src/login.js", "additions": 120, "deletions": 0 }
  ]
}
```

`additions` and `deletions` are `null` for binary files.

### `POST /git/commit`
Stages files (all of them when `files` is omitted) and commits. Falls back to
`--allow-empty` when there is nothing to commit.

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
Runs `git push` for the current branch.

**Body:** `{ "path": "/path/to/workspace" }`

**Response:**
```json
{
  "ok": true,
  "output": "Everything up-to-date"
}
```

### `POST /git/pull`
Runs `git pull --rebase`.

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

Git mutations report failures as `500 { "ok": false, "error": "..." }`.

## Editor

### `POST /editor/open`
Opens a workspace file in the user's editor: the OS default for the file type,
or the editor set in Settings (`editorCommand`). From this computer only.

**Body:** `{ "workspace": "/registered/workspace", "path": "src/auth.js", "line": 42 }` (`line` optional)
**Response:** `{ "opened": true, "file": "/abs/path/src/auth.js", "line": 42, "editor": "...", "atLine": true }`

The workspace must be registered, and the file must be a real file inside it
(symlinks that lead outside are refused).

### `GET /editor/preview`
A read-only window of up to 40 lines of a workspace file, starting at `line`.
Same containment as `/editor/open`; text files of at most 1 MB only (`413` if
larger, `415` for binary files).

**Query Params:** `workspace`, `path`, `line` (default 1)
**Response:** `{ "file": "...", "startLine": 1, "totalLines": 120, "lines": ["..."] }`

### `GET /editor/options`
What the Settings editor picker offers. From this computer only.

**Response:** `{ "editorCommand": "", "systemDefault": "Visual Studio Code", "detected": [...], "placeholders": ["{file}", "{line}", "{column}"] }`

## Plugins API

Plugin management covers listing, uploading, deleting, opening, enabling, and
disabling plugins. Plugin uploads are off by default; turn them on with the
`allowPluginUploads` setting or `YODAMAN_ALLOW_PLUGIN_UPLOADS=true` (trusted
local sessions only). Default plugins (`graphify`, `Grand-Inquisitor`,
`CodeTrooper`, `Droid-Sweep`, `lightsaber`) cannot be deleted or disabled.

### `GET /plugins`
Lists loaded plugins with name, description, parameters, and permissions.

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
Uploads a plugin file (`.js` or `.zip`). A zip is extracted and its `main.js`
(or first `.js` file) installed; `permissions` from a `plugin.json` inside the
archive are added to the plugin. An uploaded plugin must declare its
permissions, and may not replace an installed plugin file (`409` for a file name
already in `plugins/`; delete the old one first). A plugin that fails
validation is removed again. Returns `403` (`plugin_uploads_disabled`) unless uploads are on.

**Body:** multipart/form-data with field `plugin` (the file).

**Response:**
```json
{
  "message": "Plugin uploaded and loaded",
  "name": "my-plugin.js"
}
```

### `DELETE /plugins/:name`
Removes a plugin from disk. Default plugins return `403`; unknown plugins `404`.

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
Runs the plugin's `open` action, which launches its viewer. Returns `404` if the
plugin is missing or disabled, and `501` (`plugin_open_not_implemented`) if it
finished without reporting `opened: true`.

**Body:** `{ "project": "/path/to/workspace", "diagnostics": {...} }` (optional; `diagnostics` is only logged)

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
Re-enables a disabled plugin.

**Response:** `{ "message": "Plugin Grand-Inquisitor enabled", "name": "Grand-Inquisitor", "enabled": true }`

### `POST /plugins/:name/disable`
Disables a plugin without removing its file. Default plugins return `403`.

**Response:** `{ "message": "Plugin my-plugin disabled", "name": "my-plugin", "disabled": true }`

## Graphify

Graphify builds the knowledge graph. The runtime **starts without it** — every
dependency check is wrapped, and a missing tool disables its features rather
than stopping the process. Graphify endpoints then return an error naming what
is missing. Every Graphify endpoint requires a registered workspace path.

### `GET /graphify/status`
Graph availability, artifact health, staleness, and the last build summary.
Large graphs can report `build.state: "partial"` when `graph.json` and the
report exist but HTML artifacts were skipped.

**Query Params:** `path`

### `POST /graphify/build`
Queues a graph build and returns at once with `202`. A build already running for
the workspace is returned instead of starting another.

**Body:** `{ "path": "/absolute/path/to/project" }`
**Response:** `{ "message": "Graphify build queued", "path": "...", "jobId": "...", "job": {...}, "build": {...} }`

### `GET /graphify/build/status`
The build job (`queued`, `running`, `succeeded`, `partial` or `failed`), the
last build summary, and graph freshness. Without `jobId`, the latest job for the
workspace. Jobs are kept in memory, so none survive a restart.

**Query Params:** `path`, `jobId` (optional)
**Response:** `{ "path": "...", "job": {...}, "build": {...}, "graph": {...} }`

### `GET /graphify/artifact`
Serves a generated Graphify HTML artifact for a registered workspace, from its
`graphify-out/` directory only.

- `path`: absolute registered workspace path.
- `type`: `mindmap`, for `graph.html`.

### `GET /graphify/report`
The Graphify markdown report for a registered workspace (`404` if none).

**Query Params:** `path`
**Response:** `{ "path": "...", "report": "# Graph report ...", "reportPath": "/path/to/project/graphify-out/graph_report.md" }`

### `POST /graphify/query`
Runs a natural-language graph traversal query.

**Body:** `{ "path": "/absolute/path/to/project", "query": "How does auth connect to sessions?" }`
**Response:** `{ "path": "...", "insights": "...", "graphPath": "..." }`

### `POST /graphify/explain`
Explains a node and its neighbouring graph context.

**Body:** `{ "path": "/absolute/path/to/project", "node": "AuthService" }`
**Response:** `{ "path": "...", "node": "AuthService", "explanation": "...", "graphPath": "..." }`

### `POST /graphify/path`
Finds a graph path between two entities.

**Body:** `{ "path": "/absolute/path/to/project", "source": "LoginForm", "target": "SessionStore" }`
**Response:** `{ "path": "...", "source": "...", "target": "...", "graphPath": "...", "result": ... }`

### `POST /graphify/affected`
Impact analysis for a node, walking its graph edges in reverse.

**Body:** `{ "path": "/absolute/path/to/project", "node": "AuthService", "depth": 2, "relations": [] }` (`depth` defaults to 2)
**Response:** `{ "path": "...", "node": "...", "depth": 2, "relations": [], "graphPath": "...", "impact": ... }`

### `GET /graphify/map`
A compact graph summary for architecture map views.

**Query Params:** `path`, `limit` (default: 80), `rank` (`order`, the default, or `degree`)

### `POST /graphify/tree`
Generates Graphify's collapsible tree artifact (`graphify-out/GRAPH_TREE.html`).

**Body:** `{ "path": "/absolute/path/to/project" }`

## Stardust API

Stardust is YodaMan's OpenSpec workspace. It runs the OpenSpec CLI for
validate, archive, list, init and diagnose, and compares intended architecture
(OpenSpec specs) with actual structure (the Graphify graph). Every Stardust
endpoint takes `projectRoot`; when it is omitted, the runtime's working
directory is used.

### `GET /stardust/drift`
Diffs OpenSpec specs against the knowledge graph: spec references to files that
no longer exist, and load-bearing modules no spec describes.

**Query Params:** `projectRoot`, `minDependents` (default: 2)

**Response:**
```json
{
  "available": true,
  "covered": true,
  "openSpecInitialized": true,
  "specCount": 4,
  "graphFileCount": 200,
  "documentedFiles": 31,
  "staleReferences": [{ "spec": "auth", "reference": "src/old-auth.js" }],
  "staleCount": 1,
  "undocumented": [{ "file": "src/new-auth.js", "dependents": 6 }],
  "undocumentedCount": 1,
  "inSync": false,
  "summary": "..."
}
```

`undocumented` lists at most 20 files, most depended-on first. Without a graph
the response is `{ "available": false, "reason": "..." }`. `covered` is `false`
when the workspace has no specs, and `inSync` is never `true` without specs.

### `GET /stardust/context`
Graph-grounded context for writing a change proposal: for each file the change
touches, its blast radius, covering tests, risk and top dependents, plus the
workspace's ten most central files. Requires a built graph; otherwise
`{ "available": false, "reason": "...", "hint": "..." }`.

**Query Params:** `projectRoot`, `files` (comma-separated, max 25)

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
      "summary": "..."
    }
  ]
}
```

### `GET /stardust/diagnose`
Checks the OpenSpec setup for the workspace.

**Query Params:** `projectRoot`

### `POST /stardust/run`
Runs one Stardust action. Supported actions: `diagnose`, `validate` (needs
`changeId`), `archive` (needs `changeId`), `list` (optional `specs: true`),
`init` (needs `projectRoot`; optional `tools`, default `"all"`), `install`
(`npm install -g @fission-ai/openspec`, with Repair's gate: `403` unless
`allowSelfHealInstall` is on and the request comes from this computer), and
`propose` (needs `changeId`).

`propose` does not call the OpenSpec CLI. It creates
`openspec/changes/<changeId>/` with template `proposal.md` (holding
`description` when given), `design.md` and `tasks.md`. Existing files are not
overwritten, and the response says what was created and what already existed.
`changeId` may not contain path separators or `..`.

**Body:**
```json
{
  "action": "validate",
  "changeId": "add-login",
  "projectRoot": "/path/to/project"
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

For `diagnose` the response also carries the full result in `diagnostics`.

### `GET /stardust/board`
A change-board snapshot: the REST fallback for the `/api/stardust/live`
WebSocket, and what the UI shows before the socket connects.

**Query Params:** `projectRoot`

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

Changes are newest first. `validation` is the last result stored with
`PUT /stardust/validation/:name`, or `unknown`. `graphStatus` is `current`,
`stale` or `unavailable`.

### `GET /stardust/deltas/:name`
The spec deltas of a change, from the `## ADDED/MODIFIED/REMOVED/RENAMED
Requirements` sections of its files under `openspec/changes/<name>/specs/`.

**Query Params:** `projectRoot`

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
Stores the last validation result for a change so the change board can show it.
Results are kept in memory until the runtime restarts.

**Body:** `{ "status": "ok" | "warn" | "error" }`
**Response:** `{ "ok": true, "change": "add-login", "validation": "ok" }`

### `WS /api/stardust/live`
WebSocket for live change-board updates. Sends a `snapshot` (the
`GET /stardust/board` shape) on connect and after every change under
`openspec/`, and an `activity` message for each file event. Connect with
`?projectRoot=<path>` to watch a specific workspace.

**Message types:**
- `{ "type": "snapshot", "data": { "changes": [...], "ready": true, "graphStatus": "current" } }`
- `{ "type": "activity", "data": { "event": "modified", "path": "changes/add-login/tasks.md", "detail": "...", "timestamp": 1722672000000 } }`
- `{ "type": "error", "message": "..." }`

### `GET /stardust/compose`
Everything the three tools know about one file: which OpenSpec specs mention it,
its Graphify metrics (dependents, centrality, blast radius, test coverage,
risk), and its nearest semantic neighbours from the search pipeline. Each part
reports its own `available` and `reason`, so one missing tool empties only its
part.

**Query Params:** `projectRoot`, `file` (required; repo-relative or absolute), `depth` (default: 2, clamped to 1–4), `limit` (default: 5, max 200)

**Response (abridged):**
```json
{
  "file": "backend/interfaces/RestController.js",
  "projectRoot": "/path/to/project",
  "depth": 2,
  "available": true,
  "openspec": { "available": true, "mentionedIn": [...], "specCount": 3, "reason": null },
  "graphify": { "available": true, "inGraph": true, "dependents": 12, "centrality": 45, "blastRadius": 5, "nearestDependents": [...], "coveredByTests": true, "testCount": 2, "testFiles": [...], "risk": "high", "stale": false },
  "contextExpert": {
    "available": true,
    "graphRanked": true,
    "neighbours": [
      { "file": "backend/services/searchRouter.js", "score": 0.92, "signal": {...} }
    ],
    "reason": null
  }
}
```

### `GET /stardust/spec`
The current text of a published spec, for the SpecDiff view's "current" column.
The spec ID is confined to `openspec/specs/`.

**Query Params:** `projectRoot`, `spec` (spec ID, e.g. `auth` or `auth/session`)
**Response:** `{ "available": true, "id": "auth", "path": "openspec/specs/auth.md", "text": "..." }`, or
`{ "available": false, "id": "auth", "reason": "..." }` when OpenSpec is not set up or the spec does not exist yet.

### `GET /stardust/change-impact/:name`
Resolves every file a change's spec deltas cite against the knowledge graph:
per file, its dependents, centrality, blast radius, risk and test coverage,
riskiest first. Cited files the graph does not know are listed as `stale`.

**Query Params:** `projectRoot`
**Response:** `{ "change", "available", "deltaCount", "citedCount", "files": [...], "totals": { "inGraph", "stale", "blastRadius", "untested", "highestRisk" } }`

## Health, Readiness & Repair

### `GET /health`
A health report for every runtime dependency, polled by the Electron
diagnostics page.

Checks are `node`, `runtime`, `graphify`, `ollama`, `ctx`, `openspec`, and
`config`; each has `ok` (`true`, `false`, or `null` while still being checked),
`version`, and `message`. The top-level `status` is `starting`, `ok`, or
`degraded`; `degraded` and `pending` name the checks that failed or are still
pending. `contextWindow` is the context window Ollama serves (`null` if it could
not be read).

**Response:**
```json
{
  "status": "ok",
  "contextWindow": { "...": "..." },
  "started": true,
  "uptimeSeconds": 3600,
  "checks": {
    "node": { "ok": true, "version": "v24.11.0", "message": "v24.11.0 on darwin arm64" },
    "runtime": { "ok": true, "version": null, "message": "PID 12345, listening on port 3090" },
    "graphify": { "ok": true, "version": "...", "message": "..." },
    "ollama": { "ok": true, "version": "...", "message": "..." },
    "ctx": { "ok": true, "version": "1.3.4", "message": "..." },
    "openspec": { "ok": true, "version": "...", "message": "..." },
    "config": { "ok": true, "version": null, "message": "..." }
  },
  "degraded": [],
  "pending": [],
  "services": { "ollama": { "running": true } },
  "projects": { "total": 3, "indexed": 3, "synced": true },
  "readiness": { "overall": "ready", "trustworthy": true, "workspaces": [...] },
  "memory": { "rss": 123456789, "heapTotal": 98765432, "heapUsed": 54321098, "external": 1234567, "arrayBuffers": 12345 },
  "platform": { "hostname": "machine", "release": "25.0.0", "arch": "arm64" },
  "tasks": { "total": 3, "pendingApprovals": 1 },
  "plugins": [{ "name": "graphify", "permissions": [...], "restricted": true }]
}
```

### `GET /readiness`
One trust verdict per workspace, combining the Context Expert index state and
the Graphify graph state, so a client never has to reconcile them. Each layer is
`missing`, `unindexed`, `building`, `stale` or `ready`, and the workspace takes
the weakest.

**Query Params:** `projectId` (optional — absolute path)

Without `projectId`, every watched workspace:
```json
{ "overall": "ready", "trustworthy": true, "workspaces": [ { "path": "...", "state": "ready", "trustworthy": true, "layers": {...}, "action": null, "coverage": null } ] }
```

With `projectId`, that workspace alone, including `coverage` (spec count,
undocumented and stale counts, and the top three undocumented hubs) once it is
ready:
```json
{
  "path": "/path/to/project",
  "state": "stale",
  "trustworthy": false,
  "layers": {
    "graph": { "state": "stale", "detail": "source has changed since the last graph build" },
    "index": { "state": "ready", "detail": "no pending index work" }
  },
  "action": "Run Sync Repository to refresh the graph before relying on answers.",
  "coverage": null
}
```

### `GET /setup/plan`
What is missing and what Repair would install. Nothing runs.

**Response:** `{ "satisfied": ["ollama"], "automatic": [{ "name": "ctx", "command": "npm install -g yodaman-ctx ..." }], "manual": [...], "ok": false }`

### `POST /setup/repair`
Installs what is missing, as `yodaman setup` does: only the user-space packages
(Context Expert, Graphify, OpenSpec), by fixed commands, without a shell or
sudo, then checks again. Returns `403` (`self_heal_install_disabled`) unless
`allowSelfHealInstall` is on in Settings, `403` (`repair_local_only`) from
another machine, and `409` while a repair is running.

**Response:** `{ "installed": [...], "manual": [...], "failed": [...], "stillMissing": [...] }`

### `GET /diagnostics/run`
Runs the dependency doctor now.

**Response:** `{ "ok": true, "report": {...}, "text": "..." }`

## System

### `GET /status`
Context Expert status: CLI version, database stats, embedding provider, and
model configuration.

**Response:**
```json
{
  "version": "1.3.4",
  "nodeVersion": "v24.11.0",
  "platform": "darwin",
  "database": { "sizeFormatted": "12.3 MB", "path": "/path/to/ctx/db" },
  "totalChunks": 15000,
  "projects": 3,
  "embedding": { "provider": "ollama", "model": "nomic-embed-text" },
  "llm": { "model": "llama3", "provider": "ollama" },
  "ok": true
}
```

When Context Expert is unavailable the response degrades instead of failing:
```json
{
  "version": "ctx-unavailable",
  "nodeVersion": "v24.11.0",
  "platform": "darwin",
  "database": { "sizeFormatted": "—", "path": "—" },
  "totalChunks": 0,
  "projects": 0,
  "embedding": { "provider": "—", "model": "—" },
  "llm": { "model": "Not Available", "provider": "none" },
  "ok": false,
  "error": "spawn ctx ENOENT",
  "hint": "Context Expert is not working. Use Repair on the Dashboard, or run: npm install -g yodaman-ctx --allow-scripts=better-sqlite3,protobufjs,sharp,tree-sitter,tree-sitter-javascript,tree-sitter-python,tree-sitter-typescript,tree-sitter-go,tree-sitter-rust,onnxruntime-node"
}
```

### `GET /policy`
The agent's safety policy: allowed workspace roots, allowed executables, blocked
command patterns, the audit log setting, and each plugin's permissions.

**Response:** `{ "allowedRoots": [...], "allowedExecutables": [...], "blockedCommandPatterns": [...], "auditLog": { "enabled": true, "maxEntries": 500 }, "plugins": [...] }`

### `GET /audit`
Recent tool audit log entries.

**Query Params:** `limit` (default: 100)

The audit log is stored in `yodaman.db` in the YodaMan data folder
(`audit-log.json` and `audit-log.jsonl` in the same folder are used only if the
database cannot be opened).

### `DELETE /audit`
Clears the audit log.

**Response:** `{ "message": "Audit logs cleared" }`

### `GET /desktop/diagnostics`
Runtime diagnostics for the desktop app: process info and memory, host, task
counts, where the data files are kept, plugins, and dependency health.

**Response:** `{ "runtime": {...}, "host": {...}, "tasks": {...}, "data": { "dataDir": "...", "config": {...}, "database": {...} }, "plugins": [...], "dependencies": { "ollama", "ctx", "graphify", "openspec" } }`

### `GET /logs`
Recent structured runtime logs plus index queue state:
`{ "logs": [...], "queue": {...} }`.

Optional query filters:

- `limit`: Maximum entries to return (default 200).
- `level`: `error`, `warn`, or `info`.
- `severity`: `critical`, `high`, `medium`, or `low`.
- `query`: Case-insensitive search across message, metadata, and stack traces.
- `userAction`: Source workflow such as `code_search`, `agent_tool_call`, `chat_ask`, or `startup`.
- `message`: Exact log message key.
- `since` / `until`: ISO timestamps for time-window filtering.

### `DELETE /logs`
Deletes `runtime.log` and its rotated copies, and empties the in-memory list
that `GET /logs` returns. Only this computer may clear the logs
(`403 logs_local_only` otherwise), so a paired device cannot erase the record
of what it did. The first entry afterwards is `logs_cleared`.

**Response:** `{ "message": "Logs cleared" }`, or `500 logs_clear_failed` if a
file could not be deleted (the logs are then left as they were).

### `POST /logs/client-error`
Records a frontend failure in the same log stream, for UI errors that would
otherwise only reach the browser console.

Body fields:

- `message` (required): Error message.
- `stack`: Client stack trace.
- `userAction`: Workflow such as `code_search`, `chat_ask`, or `agent_task` (default `client`).
- `component`: UI component or client surface.
- `severity`: `critical`, `high`, `medium`, or `low` (default `medium`).
- `context`: Small object with query, project, mode, or other reproduction context.

**Response:** `{ "ok": true }`

### `GET /check`
Checks a workspace path with Context Expert (`ctx check`). A path Context
Expert does not manage is reported `healthy` with `ctxManaged: false` if it
exists, and `404` if it does not.

**Query Params:** `path` (required)

### `POST /reindex`
Queues a registered workspace for re-indexing and a graph update (`404` if the
workspace is not registered).

**Body:** `{ "path": "/path/to/workspace" }`
**Response:** `{ "message": "Indexing and Graphify graph update queued" }`

## Settings & Configuration

### `GET /settings`
Returns all runtime settings. The defaults:

```json
{
  "allowPluginUploads": false,
  "allowUnrestrictedPlugins": false,
  "allowAgentCommands": false,
  "requirePairingToken": true,
  "allowSelfHealInstall": false,
  "allowedCommands": [],
  "editorCommand": ""
}
```

### `PUT /settings`
Updates one or more settings, from this computer only (`403
settings_local_only` otherwise). Accepted keys: `allowPluginUploads`,
`allowUnrestrictedPlugins`, `allowAgentCommands`, `requirePairingToken`,
`allowSelfHealInstall` (coerced to boolean), `allowedCommands` (bare executable
names only), and `editorCommand` (`"system"` or `""` means the OS default). Plugin permissions are reloaded after a save.

**Body:** `{ "allowPluginUploads": true, "requirePairingToken": true }`

**Response:** (same shape as `GET /settings`, with the new values)

### `GET /ctx/config`
Lists Context Expert's configuration (`ctx config list`).

**Response:**
```json
{
  "ok": true,
  "config": { "...": "..." }
}
```

### `POST /ctx/config`
Sets one Context Expert configuration key (`ctx config set`). From this
computer only.

**Body:** `{ "key": "model", "value": "llama3" }`

**Response:**
```json
{
  "ok": true,
  "key": "model",
  "value": "llama3"
}
```

Failures are reported as `{ "ok": false, "error": "..." }`.

### `GET /ollama/context`
The context window Ollama is configured to serve.

**Response:** `{ "managed": true, "manager": "brew", "plistPath": "...", "configured": 8192, "recommended": 32768, "allowed": [8192, 16384, 32768, 65536, 131072] }`

### `POST /ollama/context`
Sets Ollama's context window and restarts Ollama. From this computer only, and
only when Ollama is
managed by Homebrew (otherwise `409`, with the environment variable to set
yourself). The value must be one of `allowed`; the service file is backed up
first.

**Body:** `{ "tokens": 32768 }`
**Response:** `{ "ok": true, "applied": 32768, "restarted": true, "backupPath": "..." }`

### `GET /mcp/clients`
Agents that have read this runtime through MCP, most recent first. Reports when
each was last seen, not whether it is connected.

**Response:** `{ "clients": [{ "label": "...", "calls": 12, "firstSeen": "...", "lastSeen": "..." }] }`

## Pairing

Pairing tokens let another device (the mobile app) call the runtime. Tokens are
kept in memory, last 24 hours, and are lost when the runtime restarts. Pairing
routes answer only requests from this computer (`403 pairing_local_only`
otherwise), so a device on the network cannot mint its own token.

### `POST /pairing`
Creates a pairing token and link.

**Body:** `{ "runtimeUrl": "http://192.168.1.20:3090" }` (optional; defaults to the request's host). A loopback URL (`localhost`, `127.0.0.1`) is replaced by this machine's LAN address on the same port, since on a phone it would mean the phone.
**Response:** `201 { "runtimeUrl": "...", "token": "...", "expiresAt": "...", "link": "yodaman://pair?url=...&token=...", "deepLink": "..." }`

### `GET /pairing`
Lists active tokens' `createdAt` and `expiresAt` (not the tokens themselves).

### `POST /pairing/revoke`
Revokes a pairing token.

**Body:** `{ "token": "..." }`
**Response:** `{ "revoked": true }`

## File Upload

Routes under `/api/upload` store files for agent tasks. Allowed extensions:
`.dart`, `.js`, `.ts`, `.json`, `.yaml`, `.md`, `.log`, `.txt`. Maximum file
size: 5 MB (`413` if larger). Unattached temp files expire after 60 minutes.

### `POST /upload/temp`
Uploads one file to temporary storage. Returns a `fileId` for attaching it to an
agent task.

**Body:** multipart/form-data with field `file`.

**Response (`201`):**
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
Moves a temporary file into a task's storage.

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
Deletes a temporary file.

**Response:** `{ "deleted": true }`

### `GET /upload/task/:taskId/files`
Lists the files attached to a task.

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

Uploaded files can also be attached when starting a task, through the `fileIds`
array of `POST /agent/task`.
