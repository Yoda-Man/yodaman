# Logs and Audit Specification

## Purpose
YodaMan records what the runtime does in two places. The runtime log (`backend/infrastructure/Logger.js`) keeps structured JSON lines in memory, on the console and in a rotated `runtime.log` file. The audit log (`backend/infrastructure/AuditLog.js`) records every agent tool call. This capability covers both stores, the routes `GET/DELETE /api/logs`, `POST /api/logs/client-error` and `GET/DELETE /api/audit` in `backend/interfaces/RestController.js`, and the Logs window (`src/components/LogsModal.jsx`).

## Requirements

### Requirement: Log entry shape
Every log entry SHALL be one JSON object with `timestamp` (ISO 8601), `level` (`info`, `warn` or `error`), `message` (a snake_case event name), `severity`, and any extra fields the caller passes. When the caller gives no severity it SHALL be `high` for errors, `medium` for warnings and `low` for info.

#### Scenario: Error with cause
- **WHEN** `logger.error("startup_sync_failed", err)` is called
- **THEN** the entry has `error` with `name`, `message`, `code`, `status`, `stack` and, when present, `cause` with `name`, `message` and `code`

#### Scenario: Console stream
- **WHEN** an entry is written
- **THEN** errors go to `console.error`, warnings to `console.warn` and info to `console.log`, each as one JSON line

### Requirement: In-memory buffer
The logger SHALL keep the newest 500 entries in memory, dropping the oldest first. `GET /api/logs` SHALL read only this buffer, never the files.

#### Scenario: Buffer full
- **WHEN** the 501st entry is written
- **THEN** the oldest entry is removed

### Requirement: Log file and rotation
The logger SHALL append each entry to `runtime.log` in `YODAMAN_LOG_DIR`, default `~/.yodaman/logs`. Before a write would pass `YODAMAN_LOG_MAX_BYTES` (default 5 MB) it SHALL rotate `runtime.log` to `runtime.log.1`, shifting older copies up and deleting the one past `YODAMAN_LOG_MAX_FILES` (default 3). Writing a log line MUST never throw.

#### Scenario: Rotation
- **WHEN** `runtime.log` is full and `runtime.log.1`, `.2` and `.3` exist
- **THEN** `.3` is deleted, `.2` becomes `.3`, `.1` becomes `.2`, `runtime.log` becomes `.1`, and the new line starts a fresh `runtime.log`

#### Scenario: File sink fails
- **WHEN** the log folder cannot be created or written
- **THEN** file logging stops for the rest of the process and one `log_file_sink_disabled` line is printed to stderr with the reason and folder

#### Scenario: File logging switch
- **WHEN** `YODAMAN_LOG_TO_FILE` is `false`
- **THEN** no file is written; `true` forces file logging, and otherwise files are written unless `NODE_ENV` is `test`

### Requirement: Request logging
Every HTTP request SHALL get a request id and one `http_request` log entry when the response finishes, with `requestId`, `method`, `path`, `status` and `durationMs`. Responses with status 500 or above SHALL log at `error`, others at `info`.

#### Scenario: Request id
- **WHEN** a request carries `X-Request-Id`
- **THEN** that value is used as `req.id`; otherwise a random UUID is used
- **AND** the response always carries the `X-Request-Id` header

### Requirement: GET /api/logs
`GET /api/logs` SHALL return `{ logs, queue }`, where `logs` are the newest matching entries first and `queue` is the indexing queue status. It SHALL accept `limit` (default 200) and the filters `level`, `severity`, `userAction`, `message`, `query`, `since` and `until`.

#### Scenario: Exact filters
- **WHEN** `level=error&userAction=code_search` is given
- **THEN** only entries with exactly that `level` and `userAction` are returned
- **AND** `severity` and `message` filter the same way

#### Scenario: Text and time
- **WHEN** `query=timeout` is given
- **THEN** an entry matches when its whole JSON text contains `timeout`, ignoring case
- **AND** `since` and `until` drop entries with a timestamp before `since` or after `until`

#### Scenario: Limit
- **WHEN** `limit=50` is given
- **THEN** at most the newest 50 matching entries are returned, newest first

### Requirement: Clearing logs from this computer only
`DELETE /api/logs` MUST only be accepted from this computer, because the log is the trail of what a paired device did. It SHALL delete `runtime.log` and every rotated copy, then empty the memory buffer, then log `logs_cleared`.

#### Scenario: Paired device tries to clear
- **WHEN** the request does not come from loopback, even with a valid pairing token
- **THEN** the answer is 403 `{ error: "Logs can only be cleared from this computer", code: "logs_local_only" }` and nothing is deleted

#### Scenario: Cleared
- **WHEN** the request comes from this computer and the files are removed
- **THEN** the answer is `{ message: "Logs cleared" }`

#### Scenario: Files cannot be removed
- **WHEN** deleting a log file throws
- **THEN** the answer is 500 code `logs_clear_failed`, `Could not delete the log files: <reason>`, and the memory buffer is kept

### Requirement: Client error reports
`POST /api/logs/client-error` SHALL record an error reported by the UI as a `client_error` log entry with `requestId`, `userAction`, `component`, `severity`, `context` and the error. It SHALL answer `{ ok: true }`.

#### Scenario: Defaults and limits
- **WHEN** only `message` is sent
- **THEN** `userAction` is `client` and `severity` is `medium`
- **AND** `message` may be up to 4000 characters, `userAction` and `component` 100, `severity` 20, and `stack` is cut to 12000 characters

#### Scenario: Invalid report
- **WHEN** `message` is missing or empty
- **THEN** the answer is 400 code `invalid_request`, `message must be a non-empty string`

#### Scenario: UI never fails on reporting
- **WHEN** the UI's `reportClientError` call fails
- **THEN** it returns `null` instead of throwing

### Requirement: Audit records
Every agent tool call through `ToolBox` SHALL be recorded with `id`, `timestamp`, `type: "tool_call"`, `tool`, `status` (`success` or `error`), `durationMs` and `parameters`, plus `resultSummary` on success or `error` on failure. File contents MUST NOT be stored.

#### Scenario: Contents replaced by length
- **WHEN** a tool call has `content`, `newContent` or `oldContent` parameters, or a result with `content` text
- **THEN** each is stored as `[<n> chars]`

### Requirement: Audit storage
The audit log SHALL be stored in the `audit_logs` table of `yodaman.db` (columns `id`, `timestamp`, `entry`). When SQLite is not available, or a SQLite write fails, it SHALL append to `audit-log.jsonl` and rewrite `audit-log.json` in the data folder. The list in memory SHALL be capped at 500 entries.

#### Scenario: Load at start
- **WHEN** the runtime starts with SQLite available
- **THEN** entries are loaded from `audit_logs` in timestamp order
- **AND** without SQLite they come from the last 500 lines of `audit-log.jsonl`, else from `audit-log.json`

### Requirement: GET /api/audit and DELETE /api/audit
`GET /api/audit` SHALL return a JSON array of audit entries, newest first, at most `limit` (default 100). `DELETE /api/audit` SHALL remove every audit entry and answer `{ message: "Audit logs cleared" }`. `DELETE /api/audit` MUST be refused to a request that is not from this computer, like `DELETE /api/logs`.

#### Scenario: Read
- **WHEN** `GET /api/audit?limit=20` is called
- **THEN** the newest 20 entries are returned as an array, not wrapped in an object

#### Scenario: Clear refused to a paired device
- **WHEN** `DELETE /api/audit` comes from an address other than loopback
- **THEN** the answer is 403 `{ error: "The audit log can only be cleared from this computer", code: "audit_local_only" }` and nothing is deleted

#### Scenario: Clear
- **WHEN** `DELETE /api/audit` is called from this computer
- **THEN** with SQLite every row of `audit_logs` is deleted; without it `audit-log.jsonl` is emptied and `audit-log.json` rewritten as `[]`

### Requirement: Logs window
The Logs window SHALL open from the `Logs` button in the header, load the newest 300 entries with the chosen filters, and offer `Refresh`, `Copy`, `Clear` and close.

#### Scenario: Filters
- **WHEN** the window is open
- **THEN** it offers a text search, a level menu (`All levels`, `Errors`, `Warnings`, `Info`), a severity menu (`Critical`, `High`, `Medium`, `Low`) and an action menu (`Code search`, `Agent tool call`, `Chat ask`, `Startup`)
- **AND** filters apply on Enter in the search box, or with `Apply Filters` or `Refresh`

#### Scenario: Clear asks first
- **WHEN** the user presses `Clear`
- **THEN** the window asks `Clear the runtime logs? The log files on this computer will be deleted.` and only on confirmation calls `DELETE /api/logs`
- **AND** a failure shows `Could not clear logs: <reason>`, and success reloads the list

#### Scenario: Queue and copy
- **WHEN** logs load with a queue status
- **THEN** the window shows `Indexing` (`Running` or `Idle`), `Queued` and `Active PID` (`None` when idle)
- **AND** `Copy` puts the queue and every shown line as `[timestamp] LEVEL message {extra}` on the clipboard

#### Scenario: Load fails
- **WHEN** `GET /api/logs` fails
- **THEN** the window shows one `error` line `failed_to_load_logs` with the reason
