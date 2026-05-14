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
- `data: {"type": "tool_start", "tool": "searchCode", "params": {...}}`
- `data: {"type": "tool_end", "tool": "searchCode", "result": {...}}`
- `data: {"type": "final_answer", "answer": "I have created the login form..."}`

### `GET /search`
Performs semantic code search.

**Query Params:** `query`, `project` (optional), `top` (default: 10)

## System

### `GET /status`
Returns real-time system telemetry and AI model information.

### `GET /check`
Runs a health check on a specific workspace path.

### `POST /reindex`
Manually queues a workspace for re-indexing.
