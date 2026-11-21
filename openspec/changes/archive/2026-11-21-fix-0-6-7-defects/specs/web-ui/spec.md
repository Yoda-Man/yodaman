## MODIFIED Requirements

### Requirement: API client
`src/api/api.js` SHALL send every request to `VITE_YODAMAN_API_BASE` (default `/api`) with a timeout of `VITE_YODAMAN_FETCH_TIMEOUT_MS` (default 30000 ms) unless a call sets `timeoutMs`. A non-2xx response MUST reject with the JSON `error` field, else the body text, else `Request failed with HTTP <status>`, carrying `status` and `payload`.

#### Scenario: Timeout
- **WHEN** a request does not answer within its timeout
- **THEN** it is aborted and rejects with `Request timed out after <timeoutMs>ms`

#### Scenario: Runtime not running
- **WHEN** `fetch` throws a `TypeError` because nothing is listening
- **THEN** the call rejects with `YodaMan runtime is not available. Start the desktop app or run "yodaman" from Terminal, then try again.`

#### Scenario: Long calls
- **WHEN** the UI calls `repairSetup()`, `gitAction()`, `setOllamaContext()`, `runDiagnostics()` or `uploadTempFile()`
- **THEN** `POST /api/setup/repair` and `POST /api/git/{commit,push,pull,branch}` use an 11 minute timeout, `POST /api/ollama/context` and `GET /api/diagnostics/run` use 3 minutes, and `POST /api/upload/temp` uses 60000 ms

#### Scenario: Client error reports never throw
- **WHEN** `reportClientError({ message, stack, userAction, component, severity, context })` is called
- **THEN** it posts to `/api/logs/client-error` with `severity` defaulting to `medium`
- **AND** any failure resolves to `null` instead of rejecting

### Requirement: Every runtime call goes through the API client
No file in `src/` or `frontend/` other than `src/api/api.js` SHALL build an `/api` URL itself. Components and hooks MUST call `api.js`, so a UI pointed at another runtime with `VITE_YODAMAN_API_BASE` reaches it for every call, the `/api/stardust/live` WebSocket included.

#### Scenario: Alternate API base
- **WHEN** the UI is built with `VITE_YODAMAN_API_BASE=http://localhost:4090/api`
- **THEN** the health poll, the System Dashboard, Impact analysis, the git panel, the Settings MCP list and the Stardust live socket all go to `http://localhost:4090/api/...` (the socket as `ws://localhost:4090/api/stardust/live`)

### Requirement: App shell and tabs
The shell SHALL show the status bar, the workspace sidebar, and five tabs in this order: Chat (the default), Graph, Dashboard, Plugins, Stardust, plus Logs and Settings buttons. Switching tabs MUST hide the others with `display: none` rather than unmount them, so each keeps its state. Graph Studio and the Holocron viewer SHALL be lazy-loaded.

#### Scenario: Tab switch keeps state
- **WHEN** the user types in Chat, opens the Graph tab, and returns to Chat
- **THEN** the Chat tab still holds its draft, because it was never unmounted

#### Scenario: Cross-component events
- **WHEN** a component dispatches the window event `yodaman:view-in-vr` with `detail.selectedProject`
- **THEN** the shell opens `HolocronVrModal` for that project with `detail.diagnostics`
- **AND** a `yodaman:ask-agent` event closes the Holocron viewer and selects the Chat tab

#### Scenario: First-run welcome
- **WHEN** `localStorage` has no `yodaman_onboarding_seen` key
- **THEN** a four-step welcome modal opens with the titles `Welcome to YodaMan`, `Index Your Code`, `Semantic Search` and `AI Chat Q&A`
- **AND** `SKIP`, the close button, the backdrop or `Enter Workspace` sets `yodaman_onboarding_seen` to `true` and closes it
- **AND** every tab the tour names is one of the shell's tabs: `Semantic Search` points to the Search mode on the Chat tab, since there is no Search tab

### Requirement: Search view
`SearchWindow`, shown inside Chat, SHALL run each search request through an `EventSource` on `GET /api/search/stream?query=<q>&project=<workspace path or name>` and render the hits, then the local model's summary as it streams. Each hit SHALL open in the user's editor through `POST /api/editor/open`.

#### Scenario: Stream events
- **WHEN** the stream sends `results`, `summary_start`, `summary`, `summary_error`, `search_error` and `done`
- **THEN** `results` fills the list and ends the spinner, `summary_start` starts the summary with its `model`, each `summary` appends `text`, and `done` closes the stream
- **AND** `search_error` closes the stream and shows its `error`, or `Search failed`

#### Scenario: Dropped connection
- **WHEN** the connection errors before any results arrive
- **THEN** the stream is closed so it does not reconnect and rerun the search, and the view shows `Search could not reach the runtime`
- **AND** if results had arrived, a summary still writing ends with `The connection closed before the summary finished`

#### Scenario: Citations and opening hits
- **WHEN** the summary text contains `[n]` and n is at most the number of results
- **THEN** `[n]` becomes a button labelled `Go to result n` that scrolls only the results list to hit n
- **AND** a hit's path and line come from `shared/searchHits.js`, and `Open` sends `{ workspace, path, line }` to `/api/editor/open`, showing `Could not open <path>: <message>` on failure

### Requirement: Search trace
`SearchTrace` SHALL query `GET /api/search/code` with `query`, `project`, optional `activeFile` and `top=12`, and show for each hit the blended score `graphRank` and its signal bars (Semantic, Proximity, Central, Spec) from `graphSignal`. Default weights SHALL be semantic 0.50, proximity 0.20, centrality 0.15, specCoverage 0.15 (the same as `GraphRanker.DEFAULT_WEIGHTS`) unless the answer sends `weights`.

#### Scenario: Ranking formula legend
- **WHEN** results are shown
- **THEN** the `Ranking formula` legend lists all four terms with the weights in use, `semantic × 0.5 + proximity × 0.2 + centrality × 0.15 + specCoverage × 0.15` by default, and `Reading the bars` explains each of the four

#### Scenario: Graph had nothing to add
- **WHEN** the answer has `graphRanked` false
- **THEN** the Ranking tile reads `Semantic only` and the view says `Not applied to this query — the graph matched none of these hits.`
- **AND** a hit with no `graphSignal` reads `No graph signal — this result kept Context Expert's original position.`

#### Scenario: Proximity origin
- **WHEN** no active file is given
- **THEN** the Proximity origin tile reads `None` with `proximity scores 0`, and each hit says `no proximity origin set`

### Requirement: Pipeline strip, trust verdict and activity feed
The Stardust views SHALL show the pipeline as Context Expert to Graphify to OpenSpec to Drift, each segment linking to the tab it feeds (Trace, Compose, Board, Drift). `TrustDashboard` SHALL show the overall verdict as the weakest of the three layers. The activity feed SHALL list `openspec/` file events, newest first.

#### Scenario: Layer states
- **WHEN** a layer's state is `ready`, `stale`, `building`, `unindexed` or anything else
- **THEN** it is labelled `Ready`, `Stale`, `Working`, `Missing` or `Unknown`

#### Scenario: Drift label
- **WHEN** drift has not been checked, is unavailable, is in sync, or is out of sync
- **THEN** the Drift segment reads `not checked`, `unavailable`, `specs agree with code`, or `<staleCount> stale · <undocumentedCount> undocumented`

#### Scenario: Workspace refused
- **WHEN** a `/api/stardust/*` call is refused, for example 404 `workspace_not_registered`
- **THEN** the Spec layer and the Drift view show the server's `error` as their reason instead of going blank, and a validation verdict that cannot be recorded is written to the Stardust console as `✗ Could not record the validation result: <error>`

#### Scenario: Live board socket
- **WHEN** the board's `/api/stardust/live` socket is closed by the UI, on unmount or because the workspace changed
- **THEN** it is not reconnected, so exactly one socket stays open, for the current workspace
- **AND** a socket the server drops is still reconnected after 3 seconds

#### Scenario: Activity feed
- **WHEN** file events arrive
- **THEN** the Activity button shows a count capped at `9+`, the drawer lists every event, and the Board rail shows at most 40
- **AND** with no events both read `No activity yet`, and an unknown event name still renders with a generic file icon
