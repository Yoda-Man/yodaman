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

### `POST /ask`
Queries the AI engine about the current project context.

**Body:** `{ "question": "What does the auth service do?" }`
**Response:** `{ "answer": "The auth service handles..." }`

### `POST /agent/task`
Starts an autonomous agent task. This endpoint uses **Server-Sent Events (SSE)**.

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
Returns recent in-memory agent task state for external clients.

### `GET /agent/tasks/:taskId/events`
Returns recent in-memory task events for a specific agent task.

### `GET /agent/pending-approvals`
Returns active write approvals that are waiting for a human decision.

### `GET /search`
Performs semantic code search.

**Query Params:** `query`, `project` (optional), `top` (default: 10)

## System

### `GET /status`
Returns real-time system telemetry and AI model information.

### `GET /policy`
Returns runtime safety policy details, including allowed workspace roots and blocked command patterns.

### `GET /audit`
Returns recent tool audit log entries.

**Query Params:** `limit` (default: 100)

### `POST /pairing`
Creates a temporary mobile pairing payload.

**Body:** `{ "runtimeUrl": "http://192.168.1.20:3090" }` (optional)
**Response:** `{ "runtimeUrl": "...", "token": "...", "expiresAt": "...", "deepLink": "yodaman://pair?..." }`

### `GET /pairing`
Lists active pairing token metadata.

### `POST /pairing/revoke`
Revokes a pairing token.

### `GET /check`
Runs a health check on a specific workspace path.

### `POST /reindex`
Manually queues a workspace for re-indexing.
