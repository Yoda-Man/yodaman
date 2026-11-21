# Agent Chat Specification

## Purpose
Agent Chat runs a task the user types in Chat as a local reasoning loop and streams its progress back. The routes live in `backend/interfaces/RestController.js` and `backend/services/fileUploadService.js`. The loop lives in `backend/core/AgentReasoningEngine.js` with `ConversationBuffer.js`, `promptBudget.js`, `DefaultCodingSkill.js` and `QueueService.js`, history in `backend/infrastructure/TaskStore.js` and `SessionStore.js`, the event protocol in `shared/protocol.schema.json` and `shared/yodamanProtocol.js`, and the UI in `src/components/AgentChatTab.jsx`.

## Requirements

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

### Requirement: Chat session history
The system SHALL keep each workspace's chat messages in `sessions.json` in the data folder, keyed by `projectId`, capped at the newest 200 messages. `POST /api/agent/task` and `POST /api/ask` SHALL append the user message and the answer when a `projectId` is given.

#### Scenario: Read history
- **WHEN** a client calls `GET /api/sessions?projectId=/abs/workspace`
- **THEN** the server returns the array of saved messages, or `[]` for an unknown workspace

#### Scenario: Agent answer is saved
- **WHEN** an agent task with a `projectId` returns a final answer
- **THEN** a message `{ role: "ai", content, timestamp, isAgent: true, steps }` is saved, where `steps` are every streamed event

#### Scenario: Clear history
- **WHEN** a client calls `DELETE /api/sessions?projectId=/abs/workspace`
- **THEN** that workspace's list becomes empty and the server returns `{ "message": "Session cleared" }`

#### Scenario: Missing projectId
- **WHEN** `GET` or `DELETE /api/sessions` has no `projectId`, or it is longer than 4096 characters
- **THEN** the server answers 400 with code `invalid_project_id`

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

### Requirement: Cancel a task
`POST /api/agent/cancel` SHALL mark a task for cancellation. The engine MUST stop at the next safe point and emit `task_cancelled` with the message `Task cancelled.`.

#### Scenario: Cancel a running task
- **WHEN** a client posts `{ "taskId": "<id>" }`
- **THEN** the task's status becomes `cancelling` and the server returns `{ "message": "Cancellation requested", "taskId": "<id>" }`
- **AND** the loop checks before each step, after each model reply, and after the step budget runs out, then records status `cancelled` and returns `null`

#### Scenario: Cancel while waiting for approval
- **WHEN** the task is waiting at the approval gate
- **THEN** the pending decision resolves as not approved and the task ends as `cancelled` without running the tool

#### Scenario: Missing task id
- **WHEN** the body has no `taskId`
- **THEN** the server answers 400 with `{ "error": "taskId is required", "code": "invalid_task_id" }`

### Requirement: Local model loop
The engine SHALL reason with the local model only, by calling `ctx ask` through Context Expert, which serves the user's Ollama model. Each step SHALL scope the question to the workspace with `-p <indexed name>` and SHALL run at most 10 steps (`maxIterations`).

#### Scenario: Plain answer
- **WHEN** a model reply contains no tool call
- **THEN** that reply is the final answer and the task is recorded as `completed`

#### Scenario: Truncated reply
- **WHEN** `ctx` exits mid-answer and ContextEngine salvages partial output
- **THEN** the engine emits `{ "type": "response_truncated", "iteration": <n>, "message": "<reason>" }`
- **AND** if that reply is final, a note is appended saying the answer is incomplete because the Context Expert CLI exited while streaming it

#### Scenario: Citations only
- **WHEN** a reply has no substantive text, only the retrieval citation block
- **THEN** the engine adds a note asking for one prose answer or one `TOOL_CALL` line and tries the next step
- **AND** if that happens on the last step, the answer explains that Context Expert returned source citations but no generated answer on every attempt

#### Scenario: Workspace folder missing
- **WHEN** `projectId` is an absolute path that no longer exists
- **THEN** the task completes at once with an answer saying the workspace folder was not found and to edit or remove its path in Settings

### Requirement: Tool call parsing
The engine SHALL read every `TOOL_CALL {json}` line and every `<tool_call>json</tool_call>` block in a reply, in written order, and SHALL act on at most 5 per step. A block that cannot be parsed MUST be reported as an error, never dropped silently.

#### Scenario: Repairable JSON
- **WHEN** a call has a trailing comma, single quotes, a missing closing brace or a code fence
- **THEN** the engine repairs it and runs the call

#### Scenario: Malformed call
- **WHEN** a block still does not parse or has no string `name`
- **THEN** the engine emits `{ "type": "error", "message": "<reason>" }`, records status `error`, and tells the model `Error: <reason>`
- **AND** if no other call parsed, the next step runs, and on the last step the answer is `The model produced an unparseable tool call: <reason>`

#### Scenario: More than five calls
- **WHEN** a reply contains more than 5 valid calls
- **THEN** only the first 5 are considered and the model is told how many were not run

### Requirement: Running tool calls
When every call in a step is read-only and there is more than one, the engine SHALL run them together and record results in call order. Otherwise it SHALL run only the first call, through the approval gate when the tool needs it, and tell the model which calls were not run.

#### Scenario: Parallel reads
- **WHEN** a step asks for `readFile` and `listFiles`
- **THEN** both `tool_start` events are emitted, both run at once, and a failed read becomes `{ "error": "<message>" }` without discarding the other result

#### Scenario: Call that needs approval in a batch
- **WHEN** a step asks for `writeFile` and `readFile`
- **THEN** only `writeFile` runs this step and the model is told `Not run: readFile. Re-request them next turn.`

#### Scenario: Tool throws
- **WHEN** a single tool call throws
- **THEN** the engine logs `agent_tool_failed`, emits an `error` event, records status `error`, adds `Error: <message>` to the transcript, and continues with the next step

### Requirement: Step budget exhausted
When all 10 steps are used without a final answer, the engine SHALL ask the model once more, with tools forbidden, to answer from the results so far. If that fails, it SHALL list the files it examined instead of discarding them.

#### Scenario: Synthesised answer
- **WHEN** the last model turn returns a substantive, complete reply with no tool call
- **THEN** the answer is that reply followed by `_Stopped after 10 steps. This answer is based on what was found up to that point._`

#### Scenario: Evidence list
- **WHEN** the extra turn fails but files were read or found by search
- **THEN** the answer lists up to 10 examined files as `path:line` chips and suggests a narrower follow-up

#### Scenario: Nothing gathered
- **WHEN** no files were examined
- **THEN** the answer is `I reached the maximum number of steps without finishing. Please try breaking the task into smaller parts.`

### Requirement: Direct routes
Before the model loop, the engine SHALL route three kinds of task without a model step when a workspace is selected: `Run <plugin>` for one loaded plugin with no capability label and no other required parameter, a short plain search, and the exact task `Draft baseline specs`. Each SHALL emit the usual events with `routed: "direct"`.

#### Scenario: Run a plugin by name
- **WHEN** the task is `Run Droid Sweep on this workspace` and exactly one loaded plugin matches with separators ignored
- **THEN** the plugin runs with `workspacePath`, `projectPath` or `projectRoot` set to the workspace
- **AND** the answer starts `Ran **Droid-Sweep** directly (no model call — you named the tool).`
- **AND** a plugin with a capability label such as `writes files`, `runs commands`, `starts agent tasks`, `network access` or `unrestricted` takes the model loop instead

#### Scenario: Plain search
- **WHEN** the task is one line of at most 160 characters starting with a search verb such as `find`, `search for` or `where is`, has no reasoning or change word such as `why`, `explain`, `fix` or `add`, and no files are attached
- **THEN** the engine runs the shared search pipeline with `top: 20` and answers with the top 8 hits, each with its spec tags, and one sentence naming which of Context Expert, Graphify and OpenSpec shaped the results

#### Scenario: Draft baseline specs
- **WHEN** the task matches `Draft baseline specs`, optionally followed by `for this workspace` or `for this project` and a full stop, in any case
- **THEN** the engine calls `specDraft`, asks approval for `specInit` when OpenSpec is not initialized, then asks approval for each draft as a `writeFile`
- **AND** the answer lists the written and rejected files and the skipped capabilities, and a rejected `specInit` ends with `Nothing written: OpenSpec initialization was rejected, and the drafts need an openspec/ folder.`

### Requirement: Prompt construction
For the model loop the engine SHALL send a system prompt with the tool list and the default coding skill, the active workspace's absolute path, any attached files, the Stardust Brief, and the task. A model under 14B parameters served with a small context window SHALL get the compact prompt.

#### Scenario: Full prompt
- **WHEN** the model is 14B or larger, unknown, or served with a large window
- **THEN** the system prompt lists every tool with typed parameters, tells the model to call tools as a literal `TOOL_CALL {...}` line, never native function calling, and appends `DefaultCodingSkill`

#### Scenario: Compact prompt
- **WHEN** `ctx config get default_model` names a model under 14B (for example `qwen3.5:9b`) and the serving window is small
- **THEN** the compact system prompt and the one-line tool list are used, the prompt budget is 5000 characters, and `ctx ask` gets `-k 3`

#### Scenario: Brief fails
- **WHEN** building the Stardust Brief throws
- **THEN** the engine logs `stardust_brief_failed` and runs the task without it

### Requirement: Prompt budget
The prompt budget SHALL follow the context window from `OLLAMA_CONTEXT_LENGTH`: 35% of the window at 3.5 characters per token, clamped to 9000 to 120000 characters, with each tool result capped at 40% of that, clamped to 6000 to 48000. `YODAMAN_AGENT_PROMPT_CHARS` SHALL override it when set to a positive number.

#### Scenario: Unknown window
- **WHEN** `OLLAMA_CONTEXT_LENGTH` is unset
- **THEN** the window counts as small (under 8192 tokens) and the budget is 9000 prompt characters and 6000 per entry

#### Scenario: Large window
- **WHEN** `OLLAMA_CONTEXT_LENGTH=32768`
- **THEN** the budget is 40140 prompt characters and 16056 per entry

#### Scenario: Override
- **WHEN** `YODAMAN_AGENT_PROMPT_CHARS=20000`
- **THEN** the budget is 20000 prompt characters and 8000 per entry, and any value above 120000 is capped at 120000

### Requirement: Bounded transcript
Because `ctx ask` keeps no session, the engine SHALL resend the transcript each step through a ConversationBuffer that keeps the task and the newest turns verbatim, clips large entries as they arrive, and collapses older turns into one-line digests to stay within the budget.

#### Scenario: Large tool result
- **WHEN** a tool result is longer than the per-entry cap
- **THEN** it is cut and ends with `… [<n> more characters omitted from the transcript]`

#### Scenario: Older steps collapse
- **WHEN** the history exceeds the budget
- **THEN** the oldest turns move into a list headed `--- Earlier steps in this task (<n>, summarized to stay within context) ---`, each as a line such as `readFile → ok {content}`, while at least the newest 2 turns stay verbatim

#### Scenario: Fixed parts over budget
- **WHEN** the system prompt and brief alone exceed the budget
- **THEN** the history still gets at least 1500 characters and the engine logs `agent_prompt_over_budget` with a hint

### Requirement: Index refresh after writes
After a task ends, the engine SHALL re-queue the workspace for indexing and start a Graphify update for each workspace that a successful `writeFile` changed. The QueueService SHALL index one workspace at a time, first in first out, ignoring duplicates.

#### Scenario: Accepted write
- **WHEN** a task's `writeFile` succeeds in a workspace
- **THEN** when the task ends, the workspace is added to the queue and `graphify` builds with `update: true`, and a failure is logged without failing the task

#### Scenario: Indexing run
- **WHEN** the queue starts a workspace
- **THEN** it spawns `ctx index <dir> --name <unique name> --force --ignore <ignored directories>`, and on exit code 0 forgets cached projects and starts a Graphify update

#### Scenario: Folder gone
- **WHEN** a queued folder no longer exists
- **THEN** it is skipped with `index_skipped_workspace_missing` and the next item starts

### Requirement: File attachments
The upload router at `/api/upload` SHALL accept one file per request into a temporary area and let a task claim it. Only `.dart`, `.js`, `.ts`, `.json`, `.yaml`, `.md`, `.log` and `.txt` files up to 5 MB SHALL be accepted, and unclaimed files MUST be deleted after 1 hour.

#### Scenario: Upload
- **WHEN** a client posts multipart field `file` to `/api/upload/temp`
- **THEN** the server answers 201 with `{ fileId, filename, size, type }`, storing the file under `YODAMAN_UPLOAD_ROOT` or `<os tmpdir>/yodaman-agent-uploads`, in `temp/<fileId>_<sanitized name>`

#### Scenario: Rejected upload
- **WHEN** the file is missing, has another extension, or exceeds 5 MB
- **THEN** the server answers 400 `file is required`, 400 `Unsupported file type`, or 413 `File is too large`

#### Scenario: Attach to a task
- **WHEN** `POST /api/agent/task` includes up to 20 `fileIds`
- **THEN** each file moves to `tasks/<taskId>/` and its name, size and path are listed in the prompt under `Attached local files for this task:`
- **AND** a file that cannot be attached emits `{ "type": "upload_error", "fileId": "<id>", "message": "Temp file not found" }` and the task continues

#### Scenario: Other upload routes
- **WHEN** a client calls `POST /api/upload/attach` with `{ taskId, fileId }`, `DELETE /api/upload/temp/<fileId>`, or `GET /api/upload/task/<taskId>/files`
- **THEN** the server returns the attached file, `{ "deleted": true|false }`, or `{ "files": [...] }`

### Requirement: Runtime event protocol
Task event types and statuses SHALL be declared once in `shared/protocol.schema.json` and generated into `shared/yodamanProtocol.js` by `npm run generate:protocol`. The event types MUST be `task_started`, `tool_start`, `tool_end`, `awaiting_approval`, `task_cancelled`, `final_answer`, `response_truncated`, `upload_error` and `error`.

#### Scenario: Statuses
- **WHEN** a task changes state
- **THEN** its status is one of `running`, `cancelling`, `cancelled`, `awaiting_approval`, `rejected`, `error` or `completed`

#### Scenario: Unknown event
- **WHEN** `assertTaskEvent` receives an object whose `type` is not a declared event type
- **THEN** it throws `Unsupported YodaMan task event: <json>`

#### Scenario: Generated file drifts
- **WHEN** `shared/yodamanProtocol.js` differs from what the generator produces
- **THEN** `tests/infrastructure/Protocol.test.js` fails

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
