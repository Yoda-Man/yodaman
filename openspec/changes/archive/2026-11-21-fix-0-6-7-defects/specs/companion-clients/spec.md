## MODIFIED Requirements

### Requirement: Client error messages
`requestJson` SHALL turn a network failure into a runtime-unavailable error and a non-2xx response into an error carrying the server's message, with the HTTP `status` and the body's `code` set on the error. The original network error SHALL be kept as the `cause`.

#### Scenario: Runtime not running
- **WHEN** `fetch` throws `connect ECONNREFUSED` for base URL `http://127.0.0.1:3090`
- **THEN** the error message is `YodaMan runtime is not available at http://127.0.0.1:3090. Start the YodaMan desktop app or run "yodaman" from Terminal, then try again. Details: connect ECONNREFUSED`

#### Scenario: JSON error body
- **WHEN** the runtime answers 401 with `{"error":"Valid YodaMan pairing token is required","code":"pairing_token_required"}`
- **THEN** the thrown message is `Valid YodaMan pairing token is required`

#### Scenario: Unregistered workspace
- **WHEN** a Stardust route answers 404 with `{"error":"Workspace is not registered: <path>","code":"workspace_not_registered"}`
- **THEN** the thrown message is `Workspace is not registered: <path>. Add this folder to YodaMan first, then try again.`, with `status` 404 and `code` `workspace_not_registered`

#### Scenario: Text or empty error body
- **WHEN** the response is not ok and its content type is not JSON
- **THEN** the thrown message is the body text, or `YodaMan request failed with HTTP <status>` when the body is empty

### Requirement: Shared protocol constants
`shared/yodamanProtocol.js` SHALL be generated from `shared/protocol.schema.json` by `npm run generate:protocol` and SHALL export frozen `TASK_EVENT_TYPES`, `TASK_STATUSES` and `PLUGIN_PERMISSIONS`, plus `isTaskEvent` and `assertTaskEvent`.

#### Scenario: Known values
- **WHEN** a client reads the constants
- **THEN** event types are `task_started`, `tool_start`, `tool_end`, `awaiting_approval`, `task_cancelled`, `final_answer`, `response_truncated`, `upload_error` and `error`
- **AND** statuses are `running`, `cancelling`, `cancelled`, `awaiting_approval`, `rejected`, `error` and `completed`, and permissions are `read`, `write`, `command`, `network`, `search` and `unrestricted`

#### Scenario: Event check
- **WHEN** `isTaskEvent` gets a value that is not an object or whose `type` is not a known event type
- **THEN** it returns false

#### Scenario: Type declarations
- **WHEN** a TypeScript consumer imports the package
- **THEN** `yodamanProtocol.d.ts` declares `YodaManTaskEvent` and `YodaManTask`, and `yodamanClient.d.ts` declares `API_PATHS` and the `YodaManClient` interface
- **AND** that interface declares exactly the methods `createYodaManClient` returns, which `tests/architecture/CompanionClientContracts.test.js` checks

### Requirement: Pairing and authentication
Clients SHALL authenticate to a non-local runtime only with a pairing token sent in the `X-YodaMan-Token` header. Requests from the same computer SHALL pass without a token, and the VS Code extension SHALL rely on that and send none.

#### Scenario: Remote client without a valid token
- **WHEN** pairing is required and a non-local request reaches any `/api` route other than `/pairing` without a valid token
- **THEN** the runtime answers 401 with `{"error":"Valid YodaMan pairing token is required","code":"pairing_token_required"}`

#### Scenario: Pairing link format
- **WHEN** a local caller sends `POST /api/pairing` (the client's `createPairing`, optionally with `{runtimeUrl}`)
- **THEN** the runtime answers 201 with `runtimeUrl`, `token`, `expiresAt` (24 hours later), `link` and `deepLink`, where the link is `yodaman://pair?url=<encoded url>&token=<encoded token>`

#### Scenario: Pairing from a phone
- **WHEN** a non-local caller sends any `/api/pairing` request
- **THEN** the runtime answers 403 with `Pairing can only be managed from this computer`

### Requirement: Mobile tabs
The app SHALL show six tabs: `Connect`, `Ask`, `Stardust`, `Impact`, `Tasks` and `Approvals`. Stardust and Impact SHALL only read; the only write SHALL be approving or rejecting a write proposal after an alert confirmation.

#### Scenario: Ask and search
- **WHEN** the user asks or searches on the Ask tab
- **THEN** the request is scoped to the selected project, the answer text is shown, and up to 25 hits are listed by the path `shared/searchHits.js` `hitPath` reads, with a `spec` pill when `specFlag.covered`

#### Scenario: Impact depth
- **WHEN** the user picks a depth of 1 to 4 hops (default 2) and taps `Analyze`
- **THEN** the app calls `stardustCompose(project, file, depth)` and shows the JSON result cut to 4000 characters

#### Scenario: Approval gate
- **WHEN** the user taps `Approve` or `Reject` on a pending approval and confirms the `Approve write?` or `Reject write?` alert
- **THEN** the app posts the decision and reloads pending approvals
- **AND** each card shows `Dependents` from `approval.impact.impactedCount`, and `Test coverage` from `approval.impact.testCount`: `<n> covering test(s)`, `no covering test`, or the impact's `reason` when it is unavailable

#### Scenario: Drift list
- **WHEN** the Stardust tab loads drift
- **THEN** it lists each `staleReferences` entry (the cited file and the spec citing it) and each `undocumented` module with its dependent count
- **AND** with nothing to list it shows `Drift unavailable: <reason>` when the report is unavailable, otherwise `No drift reported. Load the board first.`
- **AND** a pull-to-refresh failure on the Stardust tab shows a `Stardust failed` alert instead of being ignored

#### Scenario: Cancel a task
- **WHEN** a listed task is `running`, `awaiting_approval` or `cancelling`
- **THEN** it shows a `Cancel` button that posts `cancel(taskId)` and reloads the task list
