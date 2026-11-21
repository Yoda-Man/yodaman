## MODIFIED Requirements

### Requirement: Start an agent task
`POST /api/agent/task` SHALL validate the body, MUST refuse a `projectId` that is not a registered workspace, create a task id, and answer with a `text/event-stream` response. Each event SHALL be written as one `data: <json>` line followed by a blank line, and every event SHALL carry the task id.

#### Scenario: Valid task
- **WHEN** a client posts `{ "task": "explain ToolBox.js", "projectId": "/abs/workspace" }`
- **THEN** the response has `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `Connection: keep-alive`
- **AND** the first event is `{ "taskId": "<id>", "type": "task_started", "projectId": "/abs/workspace" }`
- **AND** the task id is a `crypto.randomUUID()`

#### Scenario: Invalid body
- **WHEN** `task` is missing, empty, not a string or longer than 20000 characters, or `projectId` is not a string or is longer than 4096 characters
- **THEN** the server answers 400 with `{ "error": "<message>", "code": "invalid_request" }`, for example `task must be a non-empty string` or `task must be 20000 characters or fewer`

#### Scenario: Unregistered workspace
- **WHEN** `projectId` names a folder that is not a registered workspace
- **THEN** the server answers 404 with `{ "error": "Workspace is not registered: <path>", "code": "workspace_not_registered" }` before any stream starts, and no task or session message is created

#### Scenario: Task finishes
- **WHEN** the engine returns an answer
- **THEN** the stream sends `{ "type": "final_answer", "answer": "<text>" }` and ends
- **AND** when the engine returns `null` (cancelled or failed direct route) the stream ends with no `final_answer`

#### Scenario: Engine throws
- **WHEN** the engine throws
- **THEN** the server logs `agent_task_failed`, sends `{ "type": "error", "message": "<err.message>" }` and ends the stream
