# YodaMan Runtime Event Protocol

## Transport

Agent tasks currently stream events with Server-Sent Events from:

```http
POST /api/agent/task
```

The request body is:

```json
{
  "task": "Implement a login form",
  "projectId": "/absolute/project/path"
}
```

Each event is emitted as a JSON object in an SSE `data:` frame.

## Event Types

### `task_started`

Emitted immediately after the runtime accepts a task.

```json
{
  "type": "task_started",
  "taskId": "abc123",
  "projectId": "/absolute/project/path"
}
```

### `tool_start`

Emitted before a tool runs.

```json
{
  "type": "tool_start",
  "taskId": "abc123",
  "tool": "searchCode",
  "params": {
    "query": "auth service"
  }
}
```

### `tool_end`

Emitted after a tool completes.

```json
{
  "type": "tool_end",
  "taskId": "abc123",
  "tool": "searchCode",
  "result": {}
}
```

### `awaiting_approval`

Emitted when the agent wants to write a file and needs human approval.

```json
{
  "type": "awaiting_approval",
  "taskId": "abc123",
  "tool": "writeFile",
  "params": {
    "filePath": "/absolute/path/file.js",
    "oldContent": "previous file content",
    "newContent": "proposed file content"
  }
}
```

Clients should show a diff and then call:

```http
POST /api/agent/approve
```

With:

```json
{
  "taskId": "abc123",
  "approved": true
}
```

### `final_answer`

Emitted when the agent finishes.

```json
{
  "type": "final_answer",
  "taskId": "abc123",
  "answer": "Done."
}
```

### `task_cancelled`

Emitted when a task is cancelled.

```json
{
  "type": "task_cancelled",
  "taskId": "abc123",
  "message": "Task cancelled."
}
```

### `error`

Emitted when a task fails.

```json
{
  "type": "error",
  "taskId": "abc123",
  "message": "Something went wrong."
}
```

## Cancellation

Clients can request cancellation with:

```http
POST /api/agent/cancel
```

Body:

```json
{
  "taskId": "abc123"
}
```

The runtime should stop the reasoning loop at the next safe cancellation point.

## Task State APIs

External clients can inspect recent persisted agent state with:

```http
GET /api/agent/tasks
```

Specific persisted task event histories are available with:

```http
GET /api/agent/tasks/:taskId/events
```

Mobile and secondary clients can inspect pending approvals with:

```http
GET /api/agent/pending-approvals
```

Task state is stored locally in `task-history.json` with bounded retention and appended to `task-history.jsonl`, so recent timelines can be replayed after a runtime restart. Shared protocol constants live in `shared/yodamanProtocol.js`, with TypeScript declarations in `shared/yodamanProtocol.d.ts`.
