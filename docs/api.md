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
    "path": "/absolute/path/to/project"
  }
]
```

### `POST /projects`
Adds a new directory to the watched list and triggers initial indexing.

**Body:** `{ "path": "/path/to/dir" }`

### `DELETE /projects`
Removes a directory from the watched list.

**Body:** `{ "path": "/path/to/dir" }`

## Intelligence & AI

### `POST /mode`
Sets the active query mode. Valid modes are `code` and `doc`.

**Body:** `{ "mode": "doc", "projectId": "/absolute/path/to/project" }`
**Response:** `{ "ok": true, "mode": "doc", "projectId": "/absolute/path/to/project" }`

### `POST /ask`
Queries the AI engine about the current project context. When `projectId` resolves to a workspace path, YodaMan injects Graphify graph report context and question-specific graph traversal output before calling Context Expert.

**Body:** `{ "question": "What does the auth service do?", "projectId": "/absolute/path/to/project", "mode": "code" }`
**Response:** `{ "answer": "The auth service handles..." }`

### `POST /agent/task`
Starts an autonomous agent task. The agent loads the default coding skill, receives Graphify graph context when a workspace is provided, and streams progress over **Server-Sent Events (SSE)**.

**Body:** `{ "task": "Implement a login form" }`
**Events:**
- `data: {"type": "task_started", "taskId": "abc123", "projectId": "/path/to/project"}`
- `data: {"type": "tool_start", "tool": "searchCode", "params": {...}}`
- `data: {"type": "tool_end", "tool": "searchCode", "result": {...}}`
- `data: {"type": "awaiting_approval", "taskId": "abc123", "tool": "writeFile", "params": {...}}`
- `data: {"type": "final_answer", "answer": "I have created the login form..."}`
- `data: {"type": "task_cancelled", "taskId": "abc123", "message": "Task cancelled."}`
- `data: {"type": "error", "taskId": "abc123", "message": "..."}`

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

### `GET /search`
Performs semantic search and automatically routes the query as `code` or `doc`.

**Query Params:** `query`, `project` (optional), `top` (default: 10)

### `GET /search/code`
Forces source-code search.

**Query Params:** `query`, `project` (optional), `top` (default: 10)

### `GET /search/docs`
Forces documentation preprocessing and documentation search.

**Query Params:** `query`, `project` (optional), `top` (default: 10)

## Graphify

Graphify is a required knowledge graph layer in YodaMan 0.2.2. The runtime fails startup when the `graphify` CLI cannot be found. Graphify endpoints require a registered workspace path.

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

## System

### `GET /status`
Returns real-time system telemetry and AI model information.

Responses include an `X-Request-Id` header. Runtime logs include the same request ID for incident correlation.

### `GET /policy`
Returns runtime safety policy details, including allowed workspace roots, blocked command patterns, and plugin permissions.

### `GET /audit`
Returns recent tool audit log entries.

**Query Params:** `limit` (default: 100)

Audit entries are retained in `audit-log.json` and appended to `audit-log.jsonl`.

### `GET /desktop/diagnostics`
Returns desktop/runtime diagnostics for control surfaces.

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

**Response:**
```json
{
  "runtime": {
    "pid": 12345,
    "uptimeSeconds": 42,
    "nodeVersion": "v20.0.0",
    "platform": "darwin",
    "cwd": "/path/to/yodaman",
    "memory": {}
  },
  "host": {
    "hostname": "machine",
    "release": "23.0.0",
    "arch": "arm64"
  },
  "tasks": {
    "total": 3,
    "pendingApprovals": 1
  },
  "plugins": []
}
```

### `POST /pairing`
Creates a temporary mobile pairing payload.

**Body:** `{ "runtimeUrl": "http://192.168.1.20:3090" }` (optional)
**Response:** `{ "runtimeUrl": "...", "token": "...", "expiresAt": "...", "link": "yodaman://pair?..." }`

### `GET /pairing`
Lists active pairing token metadata.

### `POST /pairing/revoke`
Revokes a pairing token.

### `GET /check`
Runs a health check on a specific workspace path.

### `POST /reindex`
Manually queues a workspace for re-indexing.
