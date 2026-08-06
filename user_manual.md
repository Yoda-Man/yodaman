# YodaMan User Manual

Version: 0.4.4

YodaMan is a local-first AI workspace companion for developers. It keeps project context on your machine and exposes that context through the web UI, desktop app, VS Code extension, mobile companion, mandatory Graphify knowledge graph, plugin system, and local runtime API.

## 1. Setup

**Prerequisites**: Node.js 18+, Python 3.10+, and [Ollama](https://ollama.com) installed.

Install Context Expert, OpenSpec, and Graphify, then install and start YodaMan from the project root:

```bash
npm install -g @contextexpert/cli
npm install -g @fission-ai/openspec@latest
python3 -m pip install --user graphifyy
cd yodaman/core
sh setup.sh
```

The runtime listens on `http://localhost:3090`. For development with hot reload, use `npm run dev` which starts both the Express server and Vite dev server on `http://localhost:5190`.

For desktop use:

```bash
npm run desktop
```

## 2. Core concepts

### Local runtime

The Express runtime is the shared contract for every client. It serves the React UI, exposes project/search/chat/task/plugin endpoints, uses Context Expert for code and documentation intelligence, and requires Graphify for graph-aware answers.

### Workspaces

Workspaces are absolute local folder paths. Add them by pasting a path, browsing with a native folder picker in desktop clients, using the sidebar plus button, or using the desktop menu item `Add Project Folder`. You can edit a workspace path when a project moves, delete stale workspaces, validate workspace health, refresh the workspace list, and run `Sync Repository` to reindex the active workspace and update its Graphify graph.

### Graphify knowledge graph

Graphify is mandatory in 0.4.4 and runs local-only through Ollama for semantic extraction. YodaMan strips cloud provider API keys from Graphify subprocesses and forces the Ollama backend when full extraction is enabled. Reindexing builds or updates `graphify-out/graph.json` and `GRAPH_REPORT.md` for each workspace and adds the project graph to Graphify's global graph. Chat and agent answers include graph report context plus question-specific graph traversal output, and stale graphs rebuild before answer context is gathered.

The Graph tab opens Graph Studio, a project-scoped visual workspace for Graphify outputs. Graph Studio embeds the generated mind-map and Vis.js canvas artifacts, shows graph freshness, renders the markdown report, and keeps graph query plus impact analysis actions close to the visualization.

Run a local Graphify health check from the command line:

```bash
yodaman doctor --graph
```

The graph doctor reports active workspace graphs, persisted freshness, orphaned nodes, and the most dependency-heavy file. If orphaned nodes appear, run `Sync Repository` in the app or `POST /api/reindex` for that workspace.

### Dependency health check

Run `yodaman doctor` with no flags to check every required runtime dependency before starting the app:

```bash
yodaman doctor
```

The dependency doctor checks **Ollama**, **Context Expert (`ctx`)**, **Graphify**, and **OpenSpec**, reporting each tool's version, resolved path, and — for Ollama — whether its local service is responding. Anything missing is listed with the exact install command for your platform. The command exits `0` when everything is healthy and `1` when a dependency is missing or unreachable, so it can gate a script or CI step. Add `--json` for machine-readable output:

```bash
yodaman doctor --json
```

The same checks run automatically at startup, appear in the Dashboard health panel, and appear in the desktop startup diagnostics screen, where missing components offer a one-click install.

### How the three dependencies work together

Context Expert, Graphify and OpenSpec are each required, and YodaMan composes them rather than treating them as three separate tools:

- **Approving a change shows its cost.** When Yoda-Agent proposes a file write, the approval prompt reports the blast radius from the knowledge graph: how many files depend on the target, whether any test covers that path, which dependents are nearest, and an overall risk verdict. A change that reaches five or more files with no covering test is flagged as high risk. If no graph has been built yet the diff still appears, with the blast radius marked unavailable.
- **Search is Stardust-powered.** Every search blends four signals from all three mandatory tools: Context Expert semantic relevance (weight 0.50), Graphify proximity to your active file (0.20), Graphify structural centrality (0.15), and OpenSpec spec coverage — whether the file is described in any architecture spec (0.15). Results always include both code and documentation sources with provenance tags, and each hit carries a `specFlag` showing which specs describe it. Pass `activeFile` to bias results toward what you are editing.
- **Accepted changes refresh the workspace.** Once an agent task that wrote files finishes, that workspace is reindexed and its graph updated automatically — once per task, not once per file. Without this, the answer after an accepted change would be computed from stale data.
- **One readiness signal.** The Chat header shows whether this workspace's answers can be trusted: `Graph current`, `Graph stale`, `Refreshing`, or `Not indexed`. The verdict is always the weakest layer, so nothing hides behind an average. Query it directly with `GET /api/readiness?projectId=<path>`.
- **Architecture drift.** OpenSpec records the architecture you intended; the graph records the one you built. `GET /api/stardust/drift` compares them and reports two things: specs citing files that no longer exist (a spec that has quietly become wrong), and modules many files depend on that no spec describes. Requires both an initialized OpenSpec and a built graph, and tells you which is missing. Also available to the agent as the `specDrift` tool.
- **Specs grounded in real modules.** Before a change is written up, `GET /api/stardust/context?projectRoot=<path>&files=a.js,b.js` returns the workspace's architectural hubs plus the blast radius and risk of each file the change touches, so a proposal cites modules that exist and states impact it can defend.
- **Plugins share the same graph.** Droid-Sweep finds unused files from resolved import edges rather than filename guessing, and reports whether the answer came from the graph or the text-scan fallback. Lightsaber's health score now uses real per-file test coverage, and its `test-coverage` action reports the share of source files a test actually reaches, worst-and-most-depended-on first.

### Default coding skill

Yoda-Agent loads a default coding skill for implementation work. It emphasizes explicit assumptions, simple solutions, surgical edits, matching existing style, and verifying changes with targeted tests or builds.

### Supervised agent work

Agent tasks stream task starts, tool calls, approval requests, cancellations, final answers, and errors. File writes are human controlled: clients show proposed changes and require approval or rejection before the agent continues.

### Persistence and audit

Task history and audit logs persist locally in SQLite when available. If Node SQLite support is unavailable, YodaMan falls back to JSON/JSONL files. Clients can clear task history and audit logs through the runtime endpoints.

### Creating plugins with the CLI

YodaMan includes a `create-plugin` command to scaffold new plugins:

```bash
yodaman create-plugin my-tool
```

This generates:

- **`plugins/my-tool.js`** — plugin template with the standard YodaMan plugin interface (`name`, `description`, `permissions`, `parameters`, `execute`)
- **`plugins/my-tool.test.js`** — Jest test file with basic structure checks
- **`plugins/README.md`** — updated with an API reference entry for the new plugin
- **`config.json`** — auto-registers the plugin as enabled

After scaffolding, edit the generated `.js` file to implement your tool logic, update the `parameters` and `permissions`, then run `npx jest plugins/my-tool.test.js` to verify the structure.

### Plugins

Plugins are JavaScript modules that extend the agent with custom tools. A plugin should export a `name`, `description`, `parameters`, `permissions`, and an async `execute` function. Plugin uploads, unrestricted plugins, and agent shell commands are disabled by default. Enable `YODAMAN_ALLOW_PLUGIN_UPLOADS`, `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS`, or `YODAMAN_ALLOW_AGENT_COMMANDS` only during trusted local support sessions.

## 3. Web UI

- **Settings**: Open from the top-right Settings button, sidebar plus button, or Configuration modal. Paste an absolute path or use Browse in the desktop app, then add, edit, and delete workspace paths.
- **Workspaces sidebar**: Select a project, refresh the list, validate health, toggle inclusion, edit the file path, delete a workspace, and sync the selected repository.
- **Chat**: Ask questions using the selected workspace context.
- **Agent Chat**: Send open-ended agent tasks or select a **task preset** from the dropdown above the textarea. The **📊 Impact Analysis** preset pre-fills a structured prompt asking for affected files, breaking changes, and suggested tests — ideal before editing shared utilities. More presets can be added to the `TASK_PRESETS` array in `AgentChatTab.jsx`.

  Agent responses are **graph-aware**. When graph context is available, the agent cites specific files and their dependencies from the knowledge graph and appends a `[view graph](http://localhost:5190)` link so you can explore the visual graph. For example, asking "How to add a new API endpoint?" may produce an answer referencing similar endpoints found in the graph, suggesting files to create based on existing module patterns, and estimating the number of affected files.
- **Search**: Run semantic search across indexed code and documentation, optionally scoped to the selected workspace.
- **Dashboard**: View runtime status, database/index metrics, environment information, runtime diagnostics, task counts, pending approvals, plugin policy information, and mobile pairing.
- **Logs**: Open searchable runtime logs, reindex requests, index queue state, and `ctx index` output. Filter by text, level, severity, and user action, then use Copy when sharing an error.
- **Manual**: Read the in-app version of this guide.
- **Stardust**: OpenSpec CLI wrapper for structured spec-driven development. Propose, validate, apply, and archive changes with the `openspec` workflow. Includes built-in diagnostics, version checks, and one-click OpenSpec installation.
- **Plugins**: Upload JavaScript plugins, inspect permissions and parameters, refresh loaded plugins, delete non-mandatory plugin files, and manage Graphify graph status, rebuilds, and direct graph queries.

## 4. Desktop app

The Electron app starts a managed runtime sidecar when no runtime is already available on port `3090`. It also runs from the system tray.

Desktop menu and tray actions:

- `Restart Managed Runtime`: Restarts the Electron-managed backend process.
- `Copy Mobile Pairing Link`: Creates and copies a `yodaman://pair` link.
- `Add Project Folder`: Opens a native directory picker and registers the selected workspace.
- `Show YodaMan`: Restores the desktop window from the tray.
- `Quit`: Stops the desktop app and managed runtime.

If the runtime cannot start, the recovery screen shows the YodaMan logo, recent runtime logs, `Try Again`, `Open Runtime Status`, and `Copy Error`.

## 5. VS Code extension

The VS Code extension provides editor-native access to the same local runtime.

Available actions:

- Check runtime status.
- Start the configured runtime command.
- Add a workspace by browsing for a folder, pasting a path, or registering the current VS Code workspace.
- Ask about the current workspace.
- Search and reindex the current workspace.
- Open runtime logs and index queue state.
- Run and cancel agent tasks.
- Stream agent events to the output channel.
- Open proposed writes as VS Code diffs.
- Approve or reject proposed writes.
- Clear task history and audit logs.
- Use the YodaMan activity bar sidebar for runtime, workspace, task, and action state.

The default runtime URL is `http://localhost:3090`.

## 6. Mobile companion

The mobile companion can pair with the desktop runtime using `yodaman://pair` links. On the same network it can check status, list projects, choose a workspace, ask, search, inspect task timelines, open task event details, cancel active tasks, refresh pending approvals, and approve or reject proposed writes.

Use your desktop LAN address when pairing from a phone, for example `http://192.168.1.20:3090`.

## 7. Runtime API highlights

- `GET /api/projects`: List indexed and watched projects.
- `POST /api/projects`: Add a workspace path.
- `PUT /api/projects`: Update a tracked workspace path.
- `DELETE /api/projects`: Remove a tracked workspace path.
- `POST /api/reindex`: Queue a workspace for reindexing.
- `GET /api/graphify/status`: Read Graphify graph state for a workspace.
- `POST /api/graphify/build`: Rebuild or update a workspace graph.
- `POST /api/graphify/query`: Query the workspace graph.
- `POST /api/graphify/explain`: Explain a graph node and its neighbors.
- `POST /api/graphify/path`: Find a graph path between two entities.
- `POST /api/graphify/affected`: Run impact analysis for a graph node.
- `GET /api/graphify/map`: Read a compact architecture map summary.
- `POST /api/graphify/tree`: Generate Graphify's D3 tree artifact.
- `GET /api/search`: Run unified Stardust-powered search across code and docs. Accepts `query`, `project`, `top` (default 15), `activeFile`. Returns merged results with `_source` provenance (`code`|`docs`), `specFlag` annotations, and `graphRank` scores with the four-signal breakdown.
- `POST /api/ask`: Ask a question.
- `GET /api/status`: Read Context Expert status.
- `GET /api/desktop/diagnostics`: Read runtime, task, host, and plugin diagnostics.
- `GET /api/plugins`, `POST /api/plugins`, `DELETE /api/plugins/:name`: Manage plugins.
- `GET /api/agent/tasks`, `DELETE /api/agent/tasks`: Inspect or clear task history.
- `POST /api/agent/task`, `POST /api/agent/approve`, `POST /api/agent/cancel`: Run, approve, reject, or cancel agent work.
- `GET /api/stardust/drift`: Compare OpenSpec intent against the actual graph. Accepts `projectRoot` and `minDependents`. Returns stale spec references, undocumented modules, and `inSync`.
- `GET /api/stardust/context`: Graph-grounded context for authoring a change. Accepts `projectRoot` and a comma-separated `files` list.
- `GET /api/readiness`: Whether a workspace's answers are current. Pass `?projectId=<absolute path>` for one workspace, or omit it for every watched workspace. Returns `ready`, `stale`, `building`, or `unindexed`, plus the per-layer detail and a suggested action.
- `GET /api/search/code`: Code search. Accepts `activeFile` to bias ranking toward files connected to what you are editing.
- `GET /api/audit`, `DELETE /api/audit`: Inspect or clear audit logs.
- `POST /api/pairing`: Create mobile pairing links.

## 8. Troubleshooting

- **Something is missing but you are not sure what**: Run `yodaman doctor` for a full dependency report with per-tool install commands.
- **Context Expert not found**: Install `@contextexpert/cli` and confirm `ctx --version` works.
- **Graphify not found**: Install `graphifyy`, confirm `graphify --help` works, or set `YODAMAN_GRAPHIFY_BIN` to the executable path.
- **Graph health looks wrong**: Run `yodaman doctor --graph`, then sync the affected workspace if the command reports orphaned nodes or missing graphs.
- **Runtime unreachable**: Check port `3090`, then use `Restart Managed Runtime` or run `yodaman` from Terminal.
- **Moved repository**: Open Settings, edit the workspace path, save, then sync the repository.
- **Search results are stale**: Select the workspace and run `Sync Repository`.
- **Mobile cannot connect**: Use the desktop LAN IP, confirm firewall access to port `3090`, and generate a fresh pairing link.
- **Plugin blocked**: Add explicit permissions to the plugin or intentionally allow unrestricted plugins with `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true`.
- **OpenSpec not found**: Install `@fission-ai/openspec@latest` and confirm `openspec --version` works, or click "Install Now" in the Stardust tab or the desktop startup diagnostics screen. `yodaman doctor` and the Dashboard health panel both report OpenSpec status.
- **Crash screen**: Use `Copy Error` to copy the exact message and recent runtime logs.

## 9. Verification and builds

Before publishing a release:

```bash
npm test
npm run build
npm run desktop:pack
cd extensions/vscode-yodaman
npm run lint
npm run package
```

## 10. Project Stardust — OpenSpec Integration

YodaMan 0.4.4 integrates OpenSpec through the **Stardust** tab. OpenSpec provides structured spec-driven development with a propose → validate → apply → archive workflow. The tab has eight views:

- **Board**: Real-time change overview with card-based navigation, task progress bars, validation health icons, and a side-by-side spec diff viewer. Select a change to review its proposed spec deltas grouped by operation (ADDED/MODIFIED/REMOVED/RENAMED), then validate or archive directly from the diff panel. The board updates live via WebSocket — file changes in `openspec/` push instantly.
- **Drift**: Architecture drift detection comparing OpenSpec specs against the knowledge graph. Shows stale spec references (files cited in specs that no longer exist) and undocumented modules (load-bearing files no spec describes). Unique to YodaMan.
- **Compose**: File-centric cross-reference. Enter any repo path to see which OpenSpec specs describe it, its Graphify structural position (dependents, centrality, blast radius, test coverage), and how Context Expert ranks it — three columns, one file.
- **Trust**: Unified health dashboard across Context Expert, Graphify, and OpenSpec with per-tool status cards and the overall WorkspaceReadiness verdict.
- **Trace**: Search ranking transparency. Every search result shows its semantic×0.50 + proximity×0.20 + centrality×0.15 + specCoverage×0.15 breakdown with colour-coded bars for each signal and a spec coverage indicator showing which OpenSpec specs describe the file.
- **Diagnostics**: Installation check, version, project initialization status, and one-click install/init buttons.
- **Commands**: Direct CLI access with Propose, Validate, Archive, List Changes, and List Specs buttons plus a scrollable console output. The Propose button creates `openspec/changes/<name>/` with proposal.md, design.md, and tasks.md.
- **Impact**: Dedicated impact analysis tool. Enter any file path to see its full blast radius with configurable hop depth (1–4), spec awareness (which OpenSpec specs describe it), test coverage mapping, and dependency chain visualization.

### Setup

```bash
npm install -g @fission-ai/openspec@latest
```

### Workflow

1. **Propose**: Create a new change proposal with a title, description, and spec path.
2. **Validate**: Check the change against your project's specs (supports `--strict` mode).
3. **Apply**: Apply the validated change (supports `--dry-run` for safety).
4. **Archive**: Archive a completed change.

### Diagnostics

The Stardust tab includes a Diagnostics panel that checks:
- OpenSpec installation status
- Current OpenSpec version
- Whether `openspec/project.md` exists in your workspace

### Agent Tools

The Yoda-Agent has four OpenSpec tools available during autonomous tasks:

- `specPropose(project, changeName, description)` — Creates a new change proposal under `openspec/changes/<name>/`.
- `specValidate(project, changeName)` — Validates a change against project specs via the CLI.
- `specArchive(project, changeName)` — Archives a completed change.
- `specDrift(project)` — Compares OpenSpec intent against the actual knowledge graph.

The agent is instructed to follow the Propose → Validate → Apply → Archive workflow for any significant feature, and to check drift before proposing new work.

### API Endpoints

- `GET /api/stardust/board?projectRoot=...` — Change-board snapshot (REST fallback for WebSocket)
- `GET /api/stardust/deltas/:name?projectRoot=...` — Operation-grouped spec deltas for a change
- `GET /api/stardust/compose?projectRoot=...&file=...` — File-centric cross-reference (OpenSpec + Graphify + Context Expert)
- `GET /api/stardust/spec?projectRoot=...&spec=...` — Current published spec text by ID
- `GET /api/stardust/change-impact/:name?projectRoot=...` — Per-change graph-resolved impact analysis
- `PUT /api/stardust/validation/:name` — Store validation result for board health icons
- `WS /api/stardust/live?projectRoot=...` — Real-time WebSocket for board + activity feed
- `GET /api/stardust/diagnose?projectRoot=...` — Run OpenSpec diagnostics
- `POST /api/stardust/run` — Execute any OpenSpec workflow action (propose, validate, archive, list, init, install)
