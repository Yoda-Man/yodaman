## MODIFIED Requirements

### Requirement: Task records
The engine SHALL record each task's id, task text, `projectId`, status, timestamps, pending approval, final answer, error and events. It SHALL persist every update through TaskStore, to the `tasks` table of the SQLite database (`node:sqlite`) or, when SQLite is unavailable, to `task-history.jsonl` and `task-history.json` in the data folder.

#### Scenario: List tasks
- **WHEN** a client calls `GET /api/agent/tasks`
- **THEN** the server returns every known task, newest `updatedAt` first

#### Scenario: Task events
- **WHEN** a client calls `GET /api/agent/tasks/<taskId>/events`
- **THEN** the server returns that task's events, each stamped with an ISO `timestamp`, or `[]` for an unknown id

#### Scenario: Limits
- **WHEN** tasks and events accumulate
- **THEN** the engine keeps the newest 200 events per task and at most 50 tasks in memory, and TaskStore keeps the newest 250 events per task and 100 tasks
- **AND** with SQLite, the rows of tasks beyond the newest 100 are deleted from the `tasks` table, so it does not grow without limit

#### Scenario: Tasks reloaded after a restart
- **WHEN** the runtime starts and a stored task has a status other than `completed`, `error` or `cancelled`, or still has a pending approval
- **THEN** the engine loads it as `cancelled`, with `pendingApproval: null` and, unless it already had one, the error `Interrupted by a runtime restart.`, because its loop and approval resolver did not survive the restart
- **AND** `GET /api/agent/pending-approvals` does not list it

#### Scenario: Clear tasks
- **WHEN** a client calls `DELETE /api/agent/tasks`
- **THEN** tasks, cancellations and pending approval resolvers are cleared, the store is emptied, and the server returns `{ "message": "Task history cleared" }`

### Requirement: Chat UI behaviour
The Chat tab SHALL stream a task into one assistant bubble, show tool steps and approval cards as they arrive, and accept prompts from other views through the `yodaman:ask-agent` window event. It MUST never send a pre-filled prompt unless the event sets `send`.

#### Scenario: Prompt from another view
- **WHEN** a view dispatches `yodaman:ask-agent` with `{ prompt }`
- **THEN** Chat comes forward and the prompt is placed in the composer, focused, unsent
- **AND** with `{ prompt, send: true }`, as Stardust's Draft Specs button does with `Draft baseline specs`, the prompt is sent at once

#### Scenario: Slow start
- **WHEN** nothing has streamed after 10 seconds
- **THEN** the bubble shows `⏳ Still working — this is a slow connection or a complex task.`

#### Scenario: Stream ends without an answer
- **WHEN** the stream closes with the bubble still streaming
- **THEN** the bubble shows `⚠️ The agent stream ended without an answer.`

#### Scenario: Composer keys
- **WHEN** the user presses Enter or Cmd/Ctrl+Enter in the composer
- **THEN** the message is sent, while Shift+Enter or Alt+Enter inserts a newline

#### Scenario: Thread persistence
- **WHEN** the thread changes and no message is still streaming
- **THEN** after 300 ms it is saved to `localStorage` under `yodaman:messages:<project id>`, and on opening a workspace it is restored from there before `GET /api/sessions` reconciles it

#### Scenario: Approval card shows what is approved
- **WHEN** an `awaiting_approval` event arrives
- **THEN** the card shows the tool's `params.arguments`, the diff when `newContent` is known, and "result cannot be predicted" when `newContent` is null instead of a diff that deletes every line
- **AND** it shows the blast radius and the specs that describe the file (`specImpact`)
