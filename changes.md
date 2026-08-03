# Changelog - YodaMan 🚀

All notable changes to the YodaMan project are documented here.

> Full history, including the 0.3.0–0.3.3 releases, is in [CHANGELOG.md](CHANGELOG.md).

## [0.3.9] - 2026-08-03

### ⚡ Real-Time Stardust Dashboard
The Stardust tab is now a full live OpenSpec dashboard, borrowing patterns from opsx-ui (RayIci/opsx-ui, MIT):
- **Change Board**: card-based navigation with task progress bars, validation health icons, and live timestamps. Click any card to open a side-by-side spec diff.
- **Spec Diff**: operation-grouped deltas (ADDED/MODIFIED/REMOVED/RENAMED) with colour-coded badges and Proposed / Side-by-side view toggle.
- **Activity Feed**: slide-over drawer showing live file events from `openspec/` pushed over WebSocket in real time.
- **Architecture Drift Panel**: first-class UI for SpecDrift — stale spec references and undocumented modules with severity colouring.
- **WebSocket + chokidar backend**: `StardustLive` watches `openspec/`, pushes snapshots + activity, with REST fallbacks.
- **Live store**: `useStardustLive` hook using React's `useSyncExternalStore` with auto-reconnect.

### 🔗 Three-Tool Composition GUI
Three new Stardust tabs that make the "Context Expert + Graphify + OpenSpec compose" claim tangible:
- **Compose**: file-centric cross-reference. Enter any repo path to see OpenSpec specs, Graphify structure (dependents, centrality, blast radius, test coverage), and Context Expert ranking — three columns, one file.
- **Trust**: unified health dashboard with per-tool status cards and WorkspaceReadiness verdict from `/api/health` and `/api/readiness`.
- **SearchTrace**: transparent ranking. Every search result shows its semantic×0.6 + proximity×0.25 + centrality×0.15 breakdown with colour-coded bars.

### 🐛 Bug Fixes
- **Plugin `minYodaManVersion` corrected**: all four `plugin.json` files had `minYodaManVersion: "1.0.0"` — a fictional version preventing plugin loading. Corrected to match actual versions.

- **CodeTrooper test no longer hangs**: default `excludeDirs` now skips `release`, `graphify-out`, `coverage`, and `downloads`. Test uses a 4-file fixture instead of scanning the entire 6.2GB project tree. Full suite runs in 1.5s instead of 4m39s.

### 📚 Documentation Rewrite
- **`docs/api/api.md`**: complete rewrite — all 66 routes documented (was ~33) across 10 new sections.
- **`docs/architecture/architecture.md`**: complete rewrite — added backend/services, backend/stardust, all 20 infrastructure modules, 9 v0.3.8 services, accurate component list.
- All version references across 12 docs updated to 0.3.9.

## [0.3.8] - 2026-08-01

### 🔭 Architecture Drift — What You Said vs What You Built
The one thing three mandatory dependencies buy that no single tool can. OpenSpec knows your intent, Graphify knows your reality, and now YodaMan diffs them.
- **Stale specs caught automatically**: A spec citing a file that no longer exists is a spec lying about your codebase. On this repo it immediately found a file deleted earlier in the same release.
- **Undocumented load-bearing code**: Modules many files depend on but no spec describes — ranked by how much leans on them.
- **Specs grounded before they're written**: `GET /api/stardust/context` hands a spec author the real architectural hubs plus per-file blast radius and risk, so proposals cite modules that actually exist.
- Available as a `specDrift` agent tool, so Yoda-Agent can check drift itself.

### 🔧 The Built-In Plugins Now Use the Graph
- **Droid-Sweep was guessing at dead code** by matching filenames against file text — so any file whose name appeared in a string looked "used", and two files sharing a name were treated as one. It now uses resolved import edges. Candidates on this repo dropped to three genuinely dead files; two of them the old method had called "used".
- **lightsaber's test-coverage penalty was doing nothing** — every file got an identical 20-point hit because the score never received coverage data. Same for TODO counts. Both now real and per-file, with untested files named.
- **`test-coverage` measured the wrong thing** — a ratio of test files to source files, which one giant test file could ace. Now: what fraction of your code a test actually reaches, worst-and-most-depended-on first.
- **TODO scanning stopped searching `node_modules`** (500 dependency hits → 5 real ones).

### 🌌 The Interface Picks a Side
YodaMan is named after a Jedi and ships plugins called Lightsaber and Holocron — the UI now commits to that. Every device is semantic, not decorative, and all motion respects reduced-motion settings.
- **Colour means something**: cyan for projected data (graph, VR), amber for specs and warnings, crimson for destructive actions, green for healthy. Colour now tells you what kind of thing you're looking at.
- **Targeting readout**: The approval diff is framed in amber HUD corner brackets — you're assessing a target before committing.
- **Holo projection**: Graph Studio gets drifting cyan scanlines and an inset bloom, so projected data reads as projected.
- **Saber ignition**: A blade of light sweeps across Approve, Reject, Send, and Enter VR — only the controls that actually commit something.
- **Starfield** texture on the status bar and Holocron shell.
- **Truly local-first now**: The app used to fetch its fonts from Google on every launch — a third-party request in a product that promises privacy by design, and a guaranteed fallback to generic system fonts in the offline desktop app. Inter, Outfit and JetBrains Mono are now bundled with the app. Verified: zero font-CDN requests, correct faces rendering.
- **Fixed**: the clock stopped jittering every second (tabular numerals).

### ⛓️ The Three Dependencies Now Compose
Context Expert, Graphify and OpenSpec each ran in their own tab and nowhere else. Now each one's output feeds the next.
- **Know the cost before you approve**: A proposed write shows its blast radius — how many files depend on it, whether any test covers the path, and a risk verdict — next to the diff. Approval becomes a risk decision instead of diff-reading.
- **Search that understands structure**: Results are reranked by graph proximity to the file you're in, not just text similarity. Real example: querying `logger` moved `Logger.js` from 10th place to 1st, and dropped `package-lock.json` from 2nd to 6th.
- **No more silent staleness**: An accepted write now reindexes and re-graphs the workspace once the task finishes, so the next answer isn't computed from stale data.
- **One trust signal**: A single badge tells you whether this workspace's answers are current, refreshing, stale, or not indexed — replacing three separate staleness notions spread across three tabs.

### 💬 Chat Tab
- **Approval gate restored**: The agent blocks waiting for write approval, but the Chat tab never showed the prompt — so any task that tried to edit a file hung forever. Proposed changes now render inline as a diff with Approve / Reject.
- **Stop a running task**: New Stop button cancels the active agent task.
- **Tool activity trail**: Each tool call is shown as it starts, finishes, or fails, instead of the UI sitting silent while the agent works.
- **Composer**: Enter sends, Shift+Enter adds a newline, Retry last prompt, copy buttons on messages and code blocks, and a confirmation before Clear.
- **Markdown**: Inline `code` and **bold** now render properly.
- **Cleaner answers**: The `ctx` CLI banner and progress lines no longer leak into responses; citations are kept.

### 🔒 Security & Correctness
- **Local chat history removed from version control**: `sessions.json` (80 stored messages across 33 workspaces) was tracked in the public repository. It is now git-ignored and untracked, with a test guarding every user-data file. Existing git history still contains it and must be purged separately.
- **Zero known vulnerabilities**: Cleared all 19 `npm audit` advisories (2 critical, 15 high, 2 low) within existing semver ranges — no declared dependency changed.
- **`ctx` install actually works now**: The install hints and one-click self-heal used `@context-expert/cli`, which does not exist on npm (404). The real package is `@contextexpert/cli`, so the "Install ctx CLI" button could never have worked.

### 🩺 Dependency Health & Diagnostics
- **`yodaman doctor`**: New full dependency health check covering Ollama, Context Expert (`ctx`), Graphify, and **OpenSpec** — version, resolved path, reachability, and the exact install command for anything missing. Add `--json` for scripting; exits non-zero when degraded.
- **OpenSpec checked everywhere**: OpenSpec is now verified by `setup.sh`, the Electron startup diagnostics table (with one-click install), the in-app health dashboard, and the CLI doctor — previously only the runtime and in-app dashboard checked it.
- **Honest health status**: `/api/health` no longer reports `degraded` on every request after startup. It now returns `ok`, `degraded`, or `starting` from the checks actually observed, plus `degraded` and `pending` arrays naming the components involved.
- **Better startup logs**: Each dependency check logs a structured result with version, path, and install hint, followed by a single `startup_health_summary` line. Missing dependencies log at `warn` (feature degraded) rather than `error` (startup failed).
- **Fixes**: `yodaman doctor` without `--graph` no longer exits with a usage error; the Electron diagnostics page no longer omits OpenSpec from its polled checks; Graphify's `installed` marker no longer renders as `vinstalled`.

## [0.3.7] - 2026-07-12

- Consolidated project-scoped semantic search into the Chat workspace.
- Added OpenSpec readiness and command-outcome charts plus separate change/spec listing in Stardust.
- Fixed Stardust forwarding for OpenSpec `specs` and `tools` options.
- Introduced VRViewer and UIPanel modules for 3D visualization and interactive UI controls.
- Enhanced SearchWindow with shared search request handling and improved error recovery.

## [0.3.6] - 2026-07-05

### 🧩 UX Fixes & State Persistence
- **Tab state preserved**: All tabs now stay mounted when switching — chat, search, graph results, dashboard, stardust, and plugins no longer reset.
- **Chat history persisted**: Messages saved to localStorage for instant restore across tab switches and app restarts.
- **Search view fixed**: ExternalLink button now toggles expanded content view with full file path and line info.
- **Health dashboard**: OpenSpec now shows in system health diagnostic table.

## [0.3.4] - 2026-07-04

### 🛰️ Project Stardust — OpenSpec Integration
- **Stardust tab**: Replaced User Manual tab with Stardust — an OpenSpec CLI wrapper for structured spec-driven development.
- **OpenSpec mandatory**: `@fission-ai/openspec` is now a required dependency. Install with `npm install -g @fission-ai/openspec@latest`.
- **StardustWrapper**: Backend service that spawns `openspec` CLI as a child process with full workflow support: propose → validate → apply → archive.
- **Diagnostics panel**: Built-in OpenSpec diagnostics — version check, project status, one-click install.
- **Live output console**: Color-coded stdout/stderr capture with structured result parsing.
- **Updated documentation**: User manual, README, and website now include OpenSpec setup instructions.
- **Fresh platform builds**: macOS, Windows, and Linux desktop builds for 0.3.4.

### 🧹 Documentation Updates
- `user_manual.md` and `public/manual.html` refreshed with Stardust/OpenSpec documentation.
- Website install instructions and download links updated for 0.3.4.

## [Unreleased]

## [0.1.5] - 2026-05-14

### 💎 Professional UI & Stability Overhaul
-   **Stress-Free Engine**: Integrated automatic port conflict detection and robust CLI output parsing.
-   **Brand Identity**: Finalized **YodaMan** branding with high-fidelity glassmorphic design.
-   **Typography**: Implemented professional fonts: **Inter** (Body), **Outfit** (Headings), and **JetBrains Mono** (Technical data).
-   **High-Tech StatusBar**: Added real-time tracking for `ctx` CLI version and active AI models.
-   **Premium Chat Interface**: Completely redesigned AI chat bubbles with "analyzing" animations and a glow-focused input field.
-   **Advanced Sidebar**: Redesigned workspace manager with better hover states and active indicators.

### 🛠️ Backend & Integration
-   **Auto-Sync Engine**: Implemented automatic discovery of repositories already indexed by the `ctx` CLI.
-   **Completed Chat API**: Added the missing `/api/ask` endpoint to bridge the frontend with the AI engine.
-   **System Status API**: New `/api/status` endpoint to dynamically fetch CLI and model metadata.
-   **File Watchers**: Improved watcher logic to handle background re-indexing reliably.

### 🧹 Cleanup & Documentation
-   **Consolidated Docs**: Merged all redundant documentation into a single, comprehensive README inside the GUI directory.
-   **Corruption Fix**: Cleaned the project of multiple corrupted RTF files and verified all source code is standard plain-text.
-   **Vite Configuration**: Fixed missing Tailwind and PostCSS configurations to ensure consistent styling across all browsers.

---
*YodaMan v0.1.5 - May the Code be with you.*
