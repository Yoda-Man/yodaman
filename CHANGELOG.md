# Changelog

All notable changes to **YodaMan** will be documented in this file.

## [0.3.9] - 2026-08-03

### Added — Stardust real-time dashboard

The Stardust tab is now a full real-time OpenSpec dashboard, borrowing and adapting patterns from opsx-ui (RayIci/opsx-ui, MIT):

- **Change Board**: card-based navigation with task progress bars, validation health icons, and "updated X ago" timestamps. Each change card is clickable — selecting one opens a side-by-side spec diff viewer.
- **Spec Diff**: operation-grouped deltas (ADDED/MODIFIED/REMOVED/RENAMED) with colour-coded badges, left-border accents, and a Proposed / Side-by-side view toggle.
- **Activity Feed**: slide-over drawer showing live file events from `openspec/` — created, modified, removed — with icons and timestamps. Pushed over WebSocket in real time.
- **Architecture Drift Panel**: first-class UI for SpecDrift — stale spec references and undocumented modules shown with severity colouring and dependency counts.
- **WebSocket + chokidar backend**: `StardustLive` watches the `openspec/` directory, pushes snapshots and activity events to all connected clients, and provides REST fallbacks (`GET /api/stardust/board`, `GET /api/stardust/deltas/:name`, `PUT /api/stardust/validation/:name`).
- **Live store**: `useStardustLive` hook using React's `useSyncExternalStore` for optimal batching with auto-reconnect and REST seeding.

### Added — Three-tool composition GUI

Three new tabs that make the "Context Expert + Graphify + OpenSpec compose" claim tangible:

- **Compose tab**: file-centric cross-reference. Enter any repo path to see what OpenSpec specs describe it, its Graphify structural position (dependents, centrality, blast radius, test coverage), and how Context Expert ranks it. Backed by `GET /api/stardust/compose`.
- **Trust tab**: unified health dashboard. Per-tool status cards (Context Expert index, Graphify graph, OpenSpec CLI), overall WorkspaceReadiness verdict, and degraded/pending detail panels. Pulls from `/api/health` and `/api/readiness`.
- **SearchTrace tab**: transparent ranking explanation. Every search result shows its semantic × 0.6 + proximity × 0.25 + centrality × 0.15 breakdown with colour-coded bars.

### Fixed

- **Plugin `minYodaManVersion` corrected**: `core/plugins/plugin.json`, `Holocron VR/plugin.json`, `Holocron VR/dist/plugin.json`, and `lightsaber/plugin.json` all had `minYodaManVersion: "1.0.0"` — a fictional version that would prevent plugin loading. Corrected to `0.3.8` (core/Holocron VR) and `0.3.0` (lightsaber).
- **Lightsaber plugin version**: `plugin.json` said `1.0.0` but `package.json` is `0.3.0` — corrected.
- **CodeTrooper test hang**: default `excludeDirs` now includes `release`, `graphify-out`, `coverage`, and `downloads`. Test uses a 4-file fixture instead of scanning the entire 6.2GB project tree. Full suite runs in 1.5s instead of hanging for 4m39s.
- **Stale `yodaman-0.2.2.tgz`** deleted and gitignored.
- **Holocron VR release zips** gitignored (`*.zip`).

### Changed — Documentation

- **`docs/api/api.md`**: complete rewrite — all 66 routes documented (was ~33). Added 10 new sections: Git API, Plugins API, Stardust Live, Health & Readiness, Sessions, Settings, Upload, and more.
- **`docs/architecture/architecture.md`**: complete rewrite — added backend/services, backend/stardust, backend/utils, all 20 infrastructure modules, 9 v0.3.8 services, accurate frontend component list, StardustLive and new Stardust components.
- **Version references**: `Management-Overview.md` bumped from 0.3.0 to 0.3.8, `AGENT.md` stale claim removed, `publishing.md` and `PUBLISHING.md` vsix versions updated, `setup.md` bumped, `runbooks.md` expanded with `yodaman doctor` and health/readiness endpoints.
- **Lightsaber README**: test-coverage action docs updated to reflect v0.3.8 graph-based behaviour.
- **Holocron VR docs**: version numbers corrected from fictional 1.0.0 to actual 0.5.1.
- **core/README.md**: fixed monorepo path, removed duplicate npm install.
- **Dockerfile**: added missing `@fission-ai/openspec`.
- **`user_manual.md`**: added prerequisites, `npm run dev`, new Stardust 7-tab layout.

### Added — earlier in 0.3.8 cycle

## [0.3.8] - 2026-08-01

### Added — architecture drift detection

The capability that only exists because all three dependencies are mandatory: OpenSpec holds the architecture you said you would build, Graphify holds the one you did, and nothing compared them. A graph-only tool has no notion of intent; a spec-only tool has no notion of reality.

- **`GET /api/stardust/drift`** and a `specDrift(project)` agent tool report two kinds of divergence: **stale references**, where a spec cites a file the graph has never seen because it was renamed or deleted, and **undocumented modules**, where a heavily depended-on file has no spec describing it. Verified on this repository's real graph, where it correctly identified `test_ctx_version.js` — deleted earlier in this same release — as a stale spec reference, and ranked `ContextEngine.js` (11 dependents) and `api.js` (11 dependents) as the most load-bearing modules with no recorded intent.
- Deliberately derives intent from what spec prose actually cites rather than requiring a new machine-readable architecture format. A reference given by bare filename is matched against the graph by basename, so ordinary spec writing does not produce false alarms.
- **`GET /api/stardust/context`** grounds a proposal before it is written: the real architectural hubs a spec can cite, plus per-target blast radius and risk. A spec written without the graph invents module names and under-counts impact.
- New `GraphFacts` service answers workspace-wide structural questions from one graph read — orphaned files, per-file test coverage, and centrality — replacing the filesystem re-derivation the plugins were each doing separately.

### Fixed — shipped plugins now use the graph they depend on

- **Droid-Sweep was guessing.** It detected dead code by building a regex from each file's basename and searching every other file's text. That reported a file as used whenever its name appeared in any string, conflated two files sharing a basename, and missed aliased and dynamic imports entirely. It now asks the graph for files with no incoming dependency edge. On this repository that took the candidate list from noise down to three files — `backend/services/contextEngine.js`, `src/components/ChatWindow.jsx`, and `src/components/Chat/ModeToggle.jsx` — each confirmed unreferenced. Two of the three were reported as *used* by the old basename approach. Entry points that no code imports (Electron main and preload, the VS Code extension entry, React Native's `App.js`) are excluded rather than flagged. The text scan remains as a fallback for workspaces with no graph, and the response states which method produced the answer.
- **lightsaber's test-coverage penalty did nothing.** `healthScore` docks 20 points for coverage below 50%, but the only call site passed just `changeFrequency` and `complexityScore`, so `fd.testCoverage` was permanently `undefined` — permanently below the threshold — and every file took an identical 20-point hit. `todoCount` was never passed either, so that penalty was always zero. Two of the four advertised scoring factors did no work. Coverage now comes from resolved graph edges and TODO counts from the scan the plugin already ran; the penalties vary per file, and untested files are named.
- **The `test-coverage` action measured the wrong thing.** It returned the ratio of test files to source files, which says nothing about whether any given file is tested — one enormous test file scored well. It now reports the percentage of source files a test actually reaches, and lists untested files ordered by how many other files depend on them. `ratio` is retained for existing consumers, with its meaning documented.
- **The TODO scan searched `node_modules`.** It returned 500 hits dominated by dependencies, and with a `head -500` cap real project TODOs could be crowded out entirely. Now excluded: on this repository, 500 dependency hits became 5 genuine ones.

### Changed — visual language

The product is named after a Jedi and ships plugins called Lightsaber, CodeTrooper and Holocron; the interface now commits to that instead of hinting at it. Every device below is semantic rather than decorative, and none of it moves for anyone with `prefers-reduced-motion` set.

- **A faction palette with meaning.** Four CSS custom properties formalise colours the app was already using ad hoc: `--holocron` (cyan) for projected data — the graph and VR; `--imperial` (amber) for specs and warnings; `--sith` (crimson) for destructive actions and high risk; `--jedi` (green) for healthy and approved. The mapping is a vocabulary, so colour now tells you what kind of thing you are looking at.
- **HUD corner brackets** (`.hud-frame`) on surfaces where you are asked to assess something before committing — the approval diff above all, framed in imperial amber like a targeting readout. Brackets only, no border, so it frames without boxing content in.
- **Holo projection** (`.holo-surface`, `.holo-scan`) on Graph Studio: faint cyan scanlines drifting on a 9-second cycle over an inset bloom, so projected data reads as projected. Kept deliberately low contrast — it must never compete with the graph itself.
- **Saber ignition** (`.saber`) — a blade of light sweeps across an action on hover and focus. Applied only to controls that commit something: Approve, Reject, Send, and Enter VR.
- **Starfield** texture on the status bar and the Holocron shell: five layers of very low-contrast points, static, as texture rather than ornament.
- **`.readout`** codifies the wide-tracked uppercase monospace label the app was repeating by hand in dozens of places.

### Fixed — test isolation

- **The test suite was writing into the live database.** `Database.js` hardcoded its path, so `Database.test.js` inserted `test-task-*` rows and fake audit entries straight into the user's real `yodaman.db` — they showed up in actual task history via `GET /api/agent/tasks`. The same coupling made the suite fail intermittently whenever the app held the file open, which is most of the time for anyone developing on it. `Database.js` now honours `YODAMAN_DB_PATH` (mirroring the existing `YODAMAN_CONFIG_PATH` convention), the test runs against a throwaway database it deletes afterwards, and a new assertion fails if the suite ever points at the real file again.

### Fixed — interface polish

- The status-bar clock re-rendered every second with proportional digits, so its width jittered continuously. Now set in `tabular-nums`, along with the diff's added/removed counts.
- **The app no longer fetches fonts from Google.** `src/index.css` opened with an `@import` to `fonts.googleapis.com`, so a product whose headline claim is local-first and private by design made a third-party request on every launch — and inside the packaged desktop app, which has no network to rely on, all three families collapsed to a generic system sans. Inter, Outfit and JetBrains Mono are now self-hosted through Fontsource (all OFL-1.1, so bundling is permitted) and Vite fingerprints the `.woff2` files into `dist/`. Verified in a browser: zero requests to any font CDN, and body, heading and monospace text resolve to the real faces rather than a fallback. Variable builds cover every weight in one file per subset, and `unicode-range` means only 4 of the 17 bundled subsets are actually downloaded for a Latin UI.
- `font-inter` and `font-outfit` had no fallbacks beyond `sans-serif`. Both now name the variable family first — Fontsource registers these as `Inter Variable` and `Outfit Variable`, so naming only the static family would have silently fallen back, reintroducing the very bug this change removes — then the static family, then a deliberate system face. `font-mono` is registered rather than assumed.

### Added — the three mandatory dependencies now compose

Context Expert, Graphify and OpenSpec were each wired to their own tab and nothing else. These changes make each one's output feed the next, so the cost of requiring all three buys something a single tool cannot.

- **Blast radius on the approval gate.** A proposed file write now shows what it reaches before you accept it: dependent file count, whether any test covers the path, the nearest dependents, and a risk verdict. New `ImpactAnalyzer` walks `graphify-out/graph.json` in-process — the `graphify affected` CLI returns prose, and the agent is blocked on the prompt while this runs, so counts are computed from the graph JSON directly. Containment edges (`contains`, `method`, `defines`) are deliberately excluded so a file's own symbols aren't counted as dependents.
- **Graph-reranked code search.** New `GraphRanker` blends Context Expert's semantic score (weighted 0.6) with graph proximity to the file you're working on (0.25) and node centrality (0.15). This matters most where retrieval has no opinion: the ctx filesystem fallback returns an identical score for every hit, so ordering collapsed to alphabetical. On a real query for `logger`, `Logger.js` moved from 10th to 1st and `package-lock.json` fell from 2nd to 6th. Reranking is advisory — no graph, or no graph coverage of the hits, returns the original order untouched.
- **The post-write loop is closed.** An approved write used to leave the index and graph stale, silently degrading the next answer. Workspaces touched by a task are now reindexed and re-graphed once when the task ends — once per task, not once per write, so a five-file change does not trigger five graph builds.
- **One workspace readiness verdict.** New `WorkspaceReadiness` collapses index state and graph build state into a single graded answer — `ready`, `stale`, `building` or `unindexed` — where the verdict is the weakest layer, never an average. Exposed on `GET /api/readiness` and inside `GET /api/health`, and shown as a badge in the Chat header so a stale answer is no longer indistinguishable from a correct one.

### Added
- **Agent write approvals are reachable again in the Chat tab.** The agent blocks on `awaiting_approval` until the user decides, but the Chat tab never rendered the prompt, so any task that tried to write a file hung indefinitely. The proposed change now appears inline as a diff with added/removed counts and Approve / Reject actions.
- **Stop button** for a running agent task, wired to `POST /api/agent/cancel`, plus handling for the `task_cancelled` event.
- **Tool activity trail** under each answer showing each tool call as it starts, completes, or fails — previously `tool_start` and `tool_end` were silently discarded, so the UI looked frozen while tools ran.
- Keyboard send in the composer (Enter to send, Shift+Enter for a newline); the composer previously had no keyboard path to send at all.
- Copy buttons on messages and code blocks, a Retry last prompt action, and a confirmation before clearing a conversation.
- Inline `code` and **bold** now render in chat markdown instead of showing raw backticks and asterisks.
- `yodaman doctor` now runs a full runtime dependency health check — Ollama, Context Expert (`ctx`), Graphify, and OpenSpec — reporting version, resolved path, reachability, and the exact install command for anything missing. Supports `--json` for scripting and exits non-zero when degraded. The existing `yodaman doctor --graph` knowledge graph check is unchanged.
- New `DependencyDoctor` service backing the CLI report, with unit coverage for healthy, missing, and installed-but-unreachable states.
- `setup.sh` now verifies OpenSpec and installs `@fission-ai/openspec@latest` when it is absent, closing the last setup path that skipped a required dependency.
- OpenSpec now appears in the Electron startup diagnostics table with a one-click install action, matching the in-app health dashboard.
- `GET /api/health` now returns `degraded` and `pending` arrays naming exactly which checks need attention, so clients no longer have to diff the whole `checks` object.

### Changed
- Startup dependency checks in `server.js` are now driven by a single table instead of three near-identical blocks, and each check logs a structured `startup_dependency_ok` / `startup_dependency_missing` entry with version, path, and install hint.
- Startup now ends with a `startup_health_summary` log line listing degraded components and resolved versions, so a support log shows the whole dependency picture without correlating individual entries.
- Missing dependencies now log at `warn` rather than `error` — they degrade features but never stop startup, and the runtime log now distinguishes the two.
- Bumped the core app, VS Code extension, in-app chrome, website, manuals, and docs to `0.3.8`.

### Security
- **`sessions.json` is no longer tracked by git.** The file holds local chat history — 80 stored user and assistant messages across 33 workspace paths — and had been committed to the public `Yoda-Man/yodaman` repository across 8 commits. It is now git-ignored and removed from the index (the local file is untouched). `yodaman.db` is git-ignored explicitly rather than by coincidence, and a `RepositoryHygiene` test now fails if any user-data file becomes tracked or drops out of `.gitignore`. **Purging the existing history and treating the exposed content as public remains an outstanding manual step.**
- Resolved every advisory reported by `npm audit` — 2 critical (`shell-quote`, `tar`), 15 high (including `multer` DoS, `form-data` CRLF injection, `axios`, `undici`, `vite`, `postcss`, `js-yaml`, and the `electron-builder` toolchain), and 2 low. All fixes applied within the existing semver ranges, so no declared dependency changed. `npm audit` now reports 0 vulnerabilities.

### Fixed
- **The `ctx` install command pointed at a package that does not exist.** Install hints and the `POST /api/health/install` self-heal command used `@context-expert/cli`, which returns 404 from the npm registry; the published package is `@contextexpert/cli`. The "Install ctx CLI" button on the desktop diagnostics screen could therefore never succeed. Corrected in `DependencyChecker`, the self-heal endpoint, the status hint, and the website install snippet.
- Chat answers no longer include the `ctx` CLI startup banner and progress chatter (`◇ injected env …`, `Searching <project>…`). Source citations are preserved.
- Streamed chat messages are addressed by a stable id instead of an array index, so loading history mid-stream can no longer route the answer into the wrong bubble.
- A chat message can no longer be left stuck in the streaming state when the stream ends without a final answer.
- The "still working" hint after 10 seconds now actually appears; its timer was previously cleared one line after being set, making the feature dead code.
- The chat thread is no longer re-serialized to local storage on every streamed token.
- `GET /api/health` reported `status: "degraded"` on every request once startup finished, even when every dependency passed. It now reports `ok`, `degraded`, or `starting` based on the checks actually observed, so a genuine failure is no longer hidden behind a permanent warning.
- The Electron diagnostics table omitted OpenSpec from its polled `checkKeys`, so a missing OpenSpec install never surfaced on the recovery screen.
- `yodaman doctor` without `--graph` exited with a usage error instead of running any health check.
- The dependency report no longer renders Graphify's `installed` marker as the nonsensical version string `vinstalled`.

## [0.3.7] - 2026-07-12

### Added
- Holocron VR modal for launching the 3D constellation view from the main app.
- `AppErrorBoundary` around the renderer so a component crash surfaces a recoverable error instead of a blank window.
- Renderer safety coverage for error-boundary and crash-recovery behaviour.

### Changed
- Search now issues a shared search request with consistent error handling and recovery across the Chat and Search surfaces.
- Stardust separates change and spec listings and reports OpenSpec readiness and command outcomes.

### Fixed
- Stardust no longer drops the OpenSpec `specs` and `tools` options when forwarding commands to the CLI.

## [0.3.6] - 2026-07-08

### Added
- OpenSpec now appears in the in-app system health diagnostic table.

### Changed
- All tabs stay mounted when switching, so chat, search, graph results, dashboard, Stardust, and Plugins no longer reset.
- Chat history persists to local storage for instant restore across tab switches and app restarts.

### Fixed
- The search result `ExternalLink` action now toggles the expanded content view with the full file path and line info.

## [0.3.5] - 2026-07-05

### Added
- `VRViewer` and `UIPanel` frontend modules for 3D visualization and interactive UI controls.
- OpenSpec registered as a first-class dependency in `DependencyChecker`, including per-platform install hints.

### Changed
- Reworked `StardustWrapper` command handling and the Stardust panel layout.
- Search window reports request failures inline instead of silently returning no results.

## [0.3.4] - 2026-07-04

### Added
- **Project Stardust** — OpenSpec integration replacing the User Manual tab with a Stardust tab driving the propose → validate → apply → archive workflow.
- `StardustWrapper` backend service that spawns the `openspec` CLI as a child process, with live colour-coded stdout/stderr capture and structured result parsing.
- OpenSpec diagnostics panel with version check, project status, and one-click install.
- `@fission-ai/openspec` is now a required dependency (`npm install -g @fission-ai/openspec@latest`).

### Changed
- User manual, in-app manual, README, and website updated with OpenSpec setup instructions.
- Fresh macOS, Windows, and Linux desktop builds.

## [0.3.3] - 2026-06-27

### Changed
- Internal release build only — captured the startup chat, VR, and search design plans that shipped in `0.3.4`. No separate published changelog entry existed for this build.

## [0.3.2] - 2026-06-23

### Changed
- Health state types tightened across the runtime and REST layer.
- `SettingsProvider` reworked for editable runtime settings.
- Test suite refactored to resolve fixtures by relative path, removing machine-specific absolute paths.

## [0.3.1] - 2026-06-17

### Added
- System health monitoring dashboard (`HealthDashboard`, `HealthIndicator`, `useHealthCheck`) polling `/api/health`.
- Runtime dependency management: `DependencyChecker` locates Ollama, `ctx`, and Graphify across platform install locations and augments the Electron `PATH`.
- `POST /api/health/install` self-heal endpoint plus one-click install actions on the Electron recovery screen.
- `GitPanel` component with local commit history, heatmap, branch info, and commit diffs.
- Editable `ctx` configuration panel in the Dashboard.

### Changed
- Electron startup now shows a diagnostics dashboard that polls runtime health before loading the app.
- Consolidated legacy standalone docs into the README, user manual, and in-app manual.

## [0.3.0] - 2026-06-10

### Added
- Plugin architecture with `PluginAPI`, plugin manifests (`plugins/plugin.json`), and upload/validation support.
- New plugins: **CodeTrooper**, **Droid-Sweep**, **Grand-Inquisitor**, and **Lightsaber**.
- `fileUploadService` and `gitService` backend services.
- `AgentChatTab` — supervised agent chat with approvals.
- Voice agent bridge and voice command handling in the frontend.
- `FileUploader` frontend component.
- `yodaman create-plugin <name>` CLI scaffold generating source, tests, README entry, and config registration.
- Holocron VR website assets and a rebuilt landing page.

### Changed
- `ToolBox` and `AgentReasoningEngine` extended for plugin-provided tools and permission policy.

## [0.2.2] - 2026-06-02

### Added
- Graph Studio production hardening for async Graphify builds, persisted build status, artifact health, and large-graph fallbacks.
- `yodaman doctor --graph` for local Graphify graph health checks across configured workspaces.
- Project session history for Anchor and a version archive of the published package.

### Changed
- Bumped the core app, visible app chrome, manuals, docs, and VS Code extension package version to `0.2.2`.

### Fixed
- Graph search chat runtime reliability, workspace leak on repeated graph builds, and stale graph build state.
- Graph Studio mind map rendering and graph artifact loading inside the Graph Studio iframe.
- Search agent diagnostics and the Plugins tab documentation link.
- Website download links now track the published release artifacts.

## [0.2.1] - 2026-05-26

### Added
- Mandatory Graphify knowledge graph integration for workspace graph builds, graph-aware chat answers, and graph-aware agent context.
- Graphify plugin metadata, a required Graphify agent tool, and Graphify controls in the Plugins tab.
- Graphify REST endpoints for status, build, query, explain, and path operations.
- Default coding skill for Yoda-Agent with assumptions, simplicity, surgical edits, and verification guidance.

### Changed
- Reindexing now queues both Context Expert indexing and Graphify graph updates.
- Updated README, user manual, in-app manual, static manual, setup docs, configuration docs, runbooks, and API reference for Graphify and 0.2.1.
- Bumped the core app and VS Code extension package versions to `0.2.1`.

### Fixed
- Workspace refresh, stale workspace deletion, invalid-path reindex diagnostics, and Graphify protection from deletion.

## [0.1.9] - 2026-05-26

### Added
- Desktop runtime recovery screen with clear next steps instead of quitting when the local service cannot start.
- Runtime retry/restart flow for the desktop app while keeping the tray and menu available.
- Friendlier runtime-unavailable messages in the shared client, web chat, VS Code extension, and mobile app.

### Changed
- Desktop now opens a startup state first, attempts to start the managed runtime, then loads the app when the service is ready.
- VS Code commands now check runtime availability before ask/search/task/reindex actions and offer to start the configured runtime command.
- Mobile app now shows an inline runtime notice with pairing guidance when the configured runtime is unreachable.

### Fixed
- Shared client query-mode calls now target `/api/mode`.
- Desktop no longer exits immediately on startup service failures.

## [0.1.8] - 2026-05-26

### Added
- Query mode documentation and API reference for `code` and `doc` flows.
- Operational runbooks, configuration reference, asset license notes, CODEOWNERS, Dockerfile, and CI workflow.
- Structured request logging with request IDs and browser-visible `X-Request-Id` correlation.
- Unit and integration coverage for query classification, documentation preprocessing, search routing, and request validation.

### Changed
- Browser API client now validates non-2xx responses, parses structured error bodies, and applies configurable request timeouts.
- Runtime port and frontend API base can now be configured through environment variables.
- README now documents new capabilities, dependencies, health endpoints, and operations docs.

### Fixed
- Imported the pairing service in the REST controller so pairing-token enforcement and pairing endpoints work.
- Added validation for query mode, ask/session payloads, agent task payloads, and workspace paths.
- Added basic security headers to the Express runtime.

## [0.1.7] - 2026-05-19

### Added
- **SQLite Database Persistence**: Added Zero-Dependency local SQLite persistence (`yodaman.db`) for task history and system audit logs with automatic JSON fallback if unsupported.
- **Electron System Tray Controls**: Integrated custom System Tray menu with controls to show/hide the app, restart background daemon, copy pairing links, and quit.
- **Hierarchical Sidebar Tree View**: Redesigned VS Code extension sidebar with collapsible sections for Status & Info, Actions, and Recent Tasks.
- **API and UI Clearing Capabilities**: Added `DELETE /api/agent/tasks` and `DELETE /api/audit` API routes, client methods, and extension actions to purge history.
- **Task Detail Inspection**: Added `yodaman.viewTaskDetails` command in VS Code extension to print step-by-step logs and tool activities.
- **Integration Tests**: Added `tests/interfaces/RestController.test.js` to verify DELETE endpoint functionality, and expanded release smoke checks for Database.js integration.

## [Unreleased]

### Added
- Shared YodaMan API/SSE client, protocol constants, and TypeScript declaration files under `shared/`.
- Append-only local audit and task history logs via `audit-log.jsonl` and `task-history.jsonl`.
- Desktop native notifications for approval-needed and completed task transitions.
- Desktop folder picker for adding project workspaces.
- Mobile task event detail view.
- Release smoke check command: `npm run release:smoke`.

### Changed
- Updated roadmap, manuals, setup, API, desktop, mobile, security, publishing, and runtime protocol documentation for the new ecosystem phase.
- Mobile app now consumes the shared client through Metro workspace configuration.

## [0.1.6] - 2026-05-17

### Added
- Expanded automated coverage for patch application, audit ordering, approval rejection, malformed tool calls, and max-iteration handling.
- Release ignore rules for VS Code extension packages, mobile build output, and desktop client artifacts.

### Changed
- Bumped the core runtime, VS Code extension, and mobile app package versions to `0.1.6`.
- Refreshed website and documentation copy around the multi-client release flow and npm publish checks.

## [0.1.5] - 2026-05-14

### Added
- **Stress-Free Initialization**: Automated detection and notification for port conflicts to prevent "EADDRINUSE" crashes.
- **Robust CLI Sync**: Enhanced JSON extraction logic to handle decorative CLI banners and "dotenvx" noise, ensuring seamless project synchronization.

## [0.1.4] - 2026-05-14

### Added
- **Plugin Marketplace**: Dynamic tool extensibility with a user-friendly upload/delete GUI.
- **Session Persistence**: High-fidelity storage for chat history and agent reasoning steps.
- **Diff Approval**: Human-in-the-loop safety mechanism for autonomous file modifications.
- **Unit Tests**: Full test suite for Plugins and SessionStore infrastructure (15/15 passing).
- **Hot-Reloading**: Real-time engine updates when plugins are added or removed.

### Changed
- **Unified API**: Transitioned to query-parameter based routing for absolute project paths.
- **Manual v0.1.4**: Updated documentation to include Plugin and Safety guides.


## [0.1.3] - 2026-05-13


### Fixed
- **Robust CLI Parsing**: Improved JSON extraction logic to reliably filter out `dotenvx` banners and other CLI-injected strings during project synchronization.

## [0.1.2] - 2026-05-13

### Added
- **Auto-Discovery**: System now automatically detects and indexes projects added via  `context-expert` (ctx) CLI without requiring a restart.
- **Unified Ecosystem Logic**: Updated the core engine to support multi-project context and documentation simultaneously.
- **Premium Branding**: New Star Wars-inspired high-tech iconography (favicon and logo).
- **Expanded Documentation**: Improved README focusing on privacy and ecosystem-wide intelligence.

### Changed
- **Architecture Refactor**: Migrated from a monolithic `server.js` to a **Clean Architecture** with dedicated Services (`CliService`, `QueueService`, `WatcherService`) and API Routes.
- **Port Migration**: Moved default ports to `5190` (Frontend) and `3090` (Backend) to eliminate common development conflicts.
- **Frontend Modernization**: Centralized API interaction into a modular client and decoupled UI logic from state management.

### Fixed
- **CLI Parsing Robustness**: Implemented regex-based JSON extraction to prevent CLI header pollution from breaking the GUI.
- **Project Synchronization**: Fixed a mismatch between GUI project labels and CLI internal names.
- **Port Conflict Management**: Resolved an issue where ghost Node processes were blocking the dev server startup.

## [0.1.1] - 2026-05-12

### Added
- Initial support for `context-expert` (ctx) CLI integration.
- Glassmorphic UI design system.
- Background indexing queue.
