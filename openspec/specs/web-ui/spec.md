# Web UI Specification

## Purpose
The web UI is the React single-page app that the runtime serves and the desktop app shows. It lives in `src/` (`main.jsx`, `App.jsx`, `api/api.js`, `components/`, `hooks/`, `holocron/`) and `frontend/` (file attachments and voice helpers), and is built by Vite from `vite.config.mjs`. This capability covers the shell, the workspace sidebar, the status bar, the System Dashboard, search views, Graph Studio and the Holocron viewer. Agent chat, Stardust panels, settings, logs, plugins and the git panel are specified elsewhere.

## Requirements

### Requirement: Build, dev server and serving
Vite SHALL serve the UI in development on port 5190 and proxy `/api` to `http://localhost:3090` with `changeOrigin` and WebSocket proxying on. The build SHALL inject `__APP_VERSION__` from `package.json`, warn only for chunks over 700 kB, and write `dist/`, which `server.js` serves for every unmatched GET path.

#### Scenario: Development proxy
- **WHEN** a developer runs `npm run client` and the UI requests `/api/health`
- **THEN** Vite on port 5190 forwards it to the runtime at `http://localhost:3090`
- **AND** `/api/stardust/live` is proxied as a WebSocket because `ws: true` is set

#### Scenario: Production serving
- **WHEN** the runtime receives a GET for a path no API route matches
- **THEN** `server.js` answers with `dist/index.html` through the `/*splat` catch-all
- **AND** if `dist/index.html` does not exist it answers 404 with the text `Frontend not built. Run npm run build.`

#### Scenario: Version in the build
- **WHEN** the UI is built
- **THEN** `__APP_VERSION__` equals the `version` field of `package.json`, which the status bar shows as `v<version>`

### Requirement: Bootstrap and crash screen
`src/main.jsx` SHALL render `<App />` inside `React.StrictMode` and `AppErrorBoundary`, and import the self-hosted Inter, Outfit and JetBrains Mono fonts from `@fontsource` packages, so no font is fetched from the network. A render error SHALL show a recovery screen instead of a blank window.

#### Scenario: Render error
- **WHEN** any component throws during render
- **THEN** the boundary logs `YodaMan renderer crashed:` with the error to the console
- **AND** shows the heading `YodaMan hit a display error`, the text `Your workspace and chat history are safe. Reload the interface to continue.`, the error message, and a `Reload YodaMan` button that calls `window.location.reload()`

#### Scenario: Fonts are local
- **WHEN** the built UI loads with no network
- **THEN** the fonts come from files bundled into `dist/` by Vite, not from Google Fonts

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

### Requirement: Workspace sidebar
The sidebar SHALL list the workspaces from `GET /api/projects`, each with its name, path and a status badge, and offer refresh, add, validate, edit path, remove and `Sync Repository`. It MUST NOT offer a per-workspace "include in context" toggle: every search and agent task is scoped to the one selected workspace, so nothing could honour it. Removing MUST ask for confirmation first. Selecting a workspace SHALL pass it to Chat, Graph, Stardust and Plugins.

#### Scenario: Empty list
- **WHEN** there are no workspaces
- **THEN** the sidebar shows `Point YodaMan at a folder` with an `Add directory` button that opens Settings

#### Scenario: Validate a workspace
- **WHEN** the user clicks `Validate Health` on a workspace
- **THEN** the UI calls `GET /api/check?path=<path>` and shows `Valid` when the answer's `status` is `healthy` (or absent), `Error` when the request fails, and `Indexed` otherwise

#### Scenario: Remove and change path
- **WHEN** the user clicks `Remove workspace` and confirms `Delete workspace "<name>" from YodaMan?`
- **THEN** the UI sends `DELETE /api/projects` with `{ path }` and drops it from the list, clearing the selection if it was selected
- **AND** saving an edited path sends `PUT /api/projects` with `{ path, nextPath }` and reloads the list

#### Scenario: Sync Repository
- **WHEN** a workspace is selected and the user clicks `Sync Repository`
- **THEN** the UI sends `POST /api/reindex` with `{ path }`, reloads the list and alerts the answer's `message` or `Indexing queued.`
- **AND** a failure alerts `Sync failed: <message>`

### Requirement: Status bar and health polling
The status bar SHALL poll `GET /api/health` every 5000 ms through `useHealthCheck` and show a health dot, `Engine:` (`ctx <version>` or `ctx unavailable`), `LLM:` (the Ollama version, `ollama`, or `n/a`), a clock updated every second, and `Build v<version>`.

#### Scenario: Health dot colours
- **WHEN** health has not loaded
- **THEN** the dot is grey and titled `Checking dependencies...`
- **AND** once loaded it is green `All systems OK` if every check has `ok: true`, amber `Degraded — some dependencies missing` if any has `ok: false`, else grey `Checking...`

#### Scenario: Health request fails
- **WHEN** `/api/health` answers non-2xx or cannot be reached
- **THEN** the hook keeps its previous `checks` and records `error`, the message `api.js` rejects with

### Requirement: System Dashboard
The Dashboard tab SHALL load `GET /api/status`, falling back to fields built from `GET /api/health` when status fails, plus `GET /api/desktop/diagnostics` and `GET /api/projects`. It SHALL show storage, AI engine, Context Expert, indexing, up to six workspaces, the ctx config editor, data file locations, the health table and runtime counters.

#### Scenario: No data at all
- **WHEN** both `/api/status` and `/api/health` fail
- **THEN** the tab shows `FAILED TO RETRIEVE SYSTEM DATA`

#### Scenario: Small Ollama context window
- **WHEN** `/api/health` reports `contextWindow.small`
- **THEN** the AI Engine card shows `Prompts are trimmed to fit, which costs answer quality.` and a `Set 32,768 & restart Ollama` button
- **AND** after a confirm dialog it sends `POST /api/ollama/context` with `{ tokens }` (the `recommended` value, default 32768) and shows `Applied <tokens> and restarted Ollama.` or the error

#### Scenario: Pair Mobile and Diagnostics
- **WHEN** the user clicks `Pair Mobile`
- **THEN** the UI sends `POST /api/pairing` with `{ runtimeUrl: window.location.origin }` and shows the returned `link` under `Mobile Pairing Link`
- **AND** `Diagnostics` calls `GET /api/diagnostics/run` and shows its `text` under `Diagnostics report` with a `Dismiss` button

#### Scenario: Edit a ctx setting
- **WHEN** `GET /api/ctx/config` answers `ok: true` and the user edits a value and presses Enter
- **THEN** the UI sends `POST /api/ctx/config` with `{ key, value }` and shows the new value only if the answer has `ok: true`
- **AND** the editable keys are grouped as Model, Embedding, Search, Observability and Evaluation

### Requirement: Health table and Repair
`HealthDashboard` SHALL show one row per check in the order node, runtime, graphify, ollama, ctx, openspec, config, each with what it unlocks, a status mark and a detail that copies on click. When any check fails it SHALL fetch `GET /api/setup/plan` and offer Repair for the plan's `automatic` steps.

#### Scenario: Repair
- **WHEN** the user clicks `Repair`
- **THEN** the UI sends `POST /api/setup/repair`, shows `Repairing… this can take a few minutes`, then re-polls health, re-fetches the plan and reloads the Dashboard
- **AND** it reports `Repaired: <names> installed and working.`, or `Repair did not finish` with what failed and `Still missing: ...`, or `Repair could not run: <error>`

#### Scenario: Health request fails before any data
- **WHEN** the first health poll fails
- **THEN** the table shows `⚠ Health check failed`, the error and a `Retry` button

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

### Requirement: Impact analysis
`ImpactAnalysisTab` SHALL analyse one file with a single `GET /api/stardust/compose` call carrying `projectRoot`, `file`, `depth` (1 to 4 hops, default 2) and `limit=40`, and show the risk, dependents, tests, graph freshness, centrality and spec count, then four lists: Graphify, OpenSpec, Test Coverage and Context Expert.

#### Scenario: No graph
- **WHEN** the answer's `graphify.available` is false
- **THEN** the tab shows `No structural impact available` with `graphify.reason` or `Graphify has no graph for this workspace.`

#### Scenario: File not in the graph
- **WHEN** `graphify.inGraph` is false
- **THEN** the tab warns that the graph has no node for the file and the path should be repo-relative

#### Scenario: Request fails
- **WHEN** the answer is not 2xx, carries `error`, or the request cannot be made
- **THEN** the tab shows `Analysis failed — ensure the workspace has a built knowledge graph and the file path is correct.` with the error

### Requirement: Graph Studio
The Graph tab SHALL show the selected workspace's Graphify graph in three modes: Mind Map (the HTML artifact in a sandboxed iframe), Report (the markdown report) and Map Preview (an SVG of up to 90 nodes and 140 links). It SHALL load status first and the map only after, and offer Build, Query Graph, Impact Lens and the top 12 nodes.

#### Scenario: No workspace
- **WHEN** no workspace is selected
- **THEN** the tab shows `Select a workspace to reveal its Graphify knowledge graph.`

#### Scenario: Build and poll
- **WHEN** the user clicks `Build`
- **THEN** the UI sends `POST /api/graphify/build` and polls `GET /api/graphify/build/status?path=&jobId=` every 2000 ms, up to 360 times
- **AND** polling stops when the job reaches `succeeded`, `partial` or `failed`, when no job is returned, or when the workspace changes, then the view reloads

#### Scenario: Mind map missing
- **WHEN** the graph exists but the mind map artifact does not
- **THEN** the view shows `Full mind map unavailable` with the skipped reason and buttons for `Map Preview` and `Report`

#### Scenario: Query and impact
- **WHEN** the user runs Query Graph or Analyze Impact
- **THEN** the UI posts to `/api/graphify/query` with `{ path, query }` or `/api/graphify/affected` with depth 3 and shows `insights` or `impact`
- **AND** a failure shows `Graph query failed: <message>` or `Impact analysis failed: <message>`

### Requirement: Holocron layout
The Holocron viewer SHALL load `GET /api/graphify/map` with `rank=degree` and a node limit of 500, 1500 (default) or 4000, then lay the graph out with the WASM engine from `/vendor/holocron-layout/` in a Web Worker. When the engine cannot run, times out after 15 s, or returns unusable positions, it MUST fall back to a deterministic spiral layout.

#### Scenario: Engine unavailable
- **WHEN** the layout falls back on a graph of two or more nodes
- **THEN** the viewer still renders, labelled `Basic layout`, and reports `Holocron layout engine unavailable: <reason>` through `/api/logs/client-error`

#### Scenario: Engine works
- **WHEN** the engine returns finite, spread-out positions
- **THEN** clusters are placed on a spiral so they do not overlap, the result is fitted to the spiral's radius, and the header reads `Force layout`

#### Scenario: Load fails
- **WHEN** fetching or building the constellation throws
- **THEN** the viewer shows `Could not start Holocron: <message>` and reports it with `userAction` `render_holocron_vr`

### Requirement: Holocron interaction
The viewer SHALL offer search, filters (tests, docs, third-party hidden by default, recent changes, languages), a 30-day change heatmap from `GET /api/git/heatmap`, a history slider from `GET /api/git/timeline`, node detail with a code preview from `GET /api/editor/preview`, voice commands, keyboard shortcuts and WebXR `immersive-vr`.

#### Scenario: Keyboard
- **WHEN** focus is not in a text field and the user presses `/` (or Cmd/Ctrl+K anywhere), `R`, `V`, `H` or Space
- **THEN** search is focused, the camera resets, voice toggles, history toggles, or history play toggles while history is open
- **AND** Escape clears the query, then the selection, then closes the filters

#### Scenario: Ask Agent
- **WHEN** the user clicks `Ask Agent` on a node
- **THEN** the viewer dispatches `yodaman:ask-agent` with a prompt `Explain <label> (<file>:<line>): what it does, what depends on it, and what would break if it changed.` and closes

#### Scenario: Voice command
- **WHEN** voice is on in Chat settings and the user says `where is auth service`
- **THEN** the viewer tries `auth service`, `authservice` and `auth_service` and flies to the first visible match
- **AND** an unrecognised phrase answers `Try "where is …", "reset", "hide tests" or "play history"`

#### Scenario: Headset
- **WHEN** `navigator.xr` supports `immersive-vr` and the user clicks `VR`
- **THEN** the viewer requests a session with optional `local-floor`, `bounded-floor` and `hand-tracking`, and a failure shows `Headset connection failed: <message>. Confirm the headset is awake, connected, and WebXR permission is allowed.`

### Requirement: Voice helpers and file attachments
`frontend/voiceAgentBridge.js` SHALL store voice settings in `localStorage` key `yodaman:voiceAgentSettings` with defaults voice input on, hotword off and voice output off. `frontend/FileUploader.jsx` SHALL upload chosen files to `POST /api/upload/temp` one at a time and keep them until removed.

#### Scenario: Continuous listening
- **WHEN** the bridge listens and a final transcript arrives
- **THEN** it normalises spoken punctuation (`new line`, `question mark`, `comma`, `period` and others), strips `Hey Yoda`, and auto-submits after a 2000 ms pause
- **AND** it stops after 10000 ms of silence, and with the hotword required it ignores speech without `hey yoda`

#### Scenario: Voice unavailable
- **WHEN** voice input is disabled or the browser has no speech recognition
- **THEN** the bridge reports `Voice input is disabled.` or `Voice input is not available in this browser.`

#### Scenario: Attach and remove files
- **WHEN** the user picks files (accepted types `.dart,.js,.ts,.json,.yaml,.md,.log,.txt`)
- **THEN** each is uploaded, duplicates by `fileId` are skipped, and the list shows name and size in KB with `Files are stored locally only.`
- **AND** removing a file drops it from the list and sends `DELETE /api/upload/temp/<fileId>`, ignoring errors
