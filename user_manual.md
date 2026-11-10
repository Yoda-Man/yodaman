# YodaMan User Manual

Version: 0.6.6

YodaMan is a local-first AI workspace companion for developers. It keeps project context on your machine and exposes that context through the web UI, desktop app, VS Code extension, mobile companion, Graphify knowledge graph, plugin system, MCP server, and local runtime API. Ollama is the only model it uses; nothing is sent to a cloud LLM.

## 1. Setup

**Prerequisites**: Node.js 24+, Python 3.10+, and [Ollama](https://ollama.com) installed.

**Model requirements**: `qwen3.5:9b` is the minimum; it works, but its tool calls are occasionally unreliable. 14B and larger (`qwen2.5:14b`, `codestral:22b`, `deepseek-coder-v2`) call tools reliably, and a larger model needs a larger `OLLAMA_CONTEXT_LENGTH` to pay off (see the README's *Choosing a model*). The agent uses Context Expert's model: set it with `ctx config set default_model <model>`. The Dashboard shows the configured model and the context window Ollama actually serves.

Install Context Expert (1.3.4 or later), OpenSpec, and Graphify, then install and start YodaMan from the repository root. `--break-system-packages` is needed for Homebrew's Python, which refuses `--user` installs otherwise; with `--user` it still writes only to your own folder. `yodaman setup` runs the same commands for you:

```bash
npm install -g yodaman-ctx --allow-scripts=better-sqlite3,protobufjs,sharp,tree-sitter,tree-sitter-javascript,tree-sitter-python,tree-sitter-typescript,tree-sitter-go,tree-sitter-rust,onnxruntime-node
npm install -g @fission-ai/openspec@latest
python3 -m pip install --user --break-system-packages graphifyy
git clone https://github.com/Yoda-Man/yodaman.git
cd yodaman
sh setup.sh
```

On macOS, `setup.sh` also installs whatever of the above is missing (through Homebrew, npm and pip), runs `npm install`, and starts YodaMan with `npm start`. `npm start` checks for `ctx`, `graphify` and `ollama` first and exits if one is missing. With the npm package installed globally, `yodaman setup` installs the missing tools on any platform.

The runtime listens on `http://127.0.0.1:3090`. For development with hot reload, use `npm run dev`, which starts both the Express server and the Vite dev server on `http://localhost:5190` (it proxies `/api` to port 3090).

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

Graphify powers the graph, impact analysis and spec coverage. The runtime starts without it; those features then report what is missing. Graphify runs local-only: by default it builds the graph without any model, and only `YODAMAN_GRAPHIFY_FULL_EXTRACT=true` uses Ollama for full semantic extraction. YodaMan strips cloud provider API keys from Graphify subprocesses and forces the Ollama backend for full extraction. Reindexing builds or updates `graphify-out/graph.json` and `GRAPH_REPORT.md` for each workspace and adds the project graph to Graphify's global graph. Chat answers include graph report context plus question-specific graph traversal output. A workspace with no graph gets one built before the answer; a stale graph is used as it is and shown as `Graph stale`, so you decide when to rebuild.

The Graph tab opens Graph Studio, a project-scoped visual workspace for Graphify outputs. Its **Mind Map** (Graphify's interactive `graph.html`), **Report** and **Map Preview** views show the generated graph, the markdown report and a compact map of up to 90 of its nodes, alongside build status, a graph query box, and impact analysis.

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

The same checks run automatically at startup, appear in the Dashboard health panel, and appear in the desktop startup diagnostics screen, where missing components offer a one-click install. Both that button and **Repair** on the Dashboard run `POST /api/setup/repair`, which installs Context Expert, Graphify and OpenSpec (never Ollama, never with sudo). It only works with **Repair Can Install Missing Tools** (`allowSelfHealInstall`) turned on in Settings, and only from this computer. Ollama always gets its install command instead.

### How the three dependencies work together

Context Expert, Graphify and OpenSpec each unlock part of YodaMan, and it composes them rather than treating them as three separate tools:

- **Approving a change shows its cost.** When Yoda-Agent proposes a file write, the approval prompt reports the blast radius from the knowledge graph: how many files depend on the target, whether any test covers that path, which dependents are nearest, and an overall risk verdict. A change that reaches five or more files with no covering test is flagged as high risk. If no graph has been built yet the diff still appears, with the blast radius marked unavailable.
- **Search is Stardust-powered.** Every search blends four signals from all three mandatory tools: Context Expert semantic relevance (weight 0.50), Graphify proximity to your active file (0.20), Graphify structural centrality (0.15), and OpenSpec spec coverage — whether the file is described in any architecture spec (0.15). Results mix code and documentation, each tagged with its source (`_source`), and each hit carries a `specFlag` showing which specs describe it. Pass `activeFile` to bias results toward what you are editing.
- **Accepted changes refresh the workspace.** Once an agent task that wrote files finishes, that workspace is reindexed and its graph updated automatically — once per task, not once per file. Without this, the answer after an accepted change would be computed from stale data.
- **One readiness signal.** The Chat header shows whether this workspace's answers can be trusted: `Graph current`, `Graph stale`, `Refreshing`, or `Not indexed`. The verdict is always the weakest layer, so nothing hides behind an average. Query it directly with `GET /api/readiness?projectId=<path>`.
- **Architecture drift.** OpenSpec records the architecture you intended; the graph records the one you built. `GET /api/stardust/drift` compares them and reports two things: specs citing files that no longer exist (a spec that has quietly become wrong), and modules many files depend on that no spec describes. Requires both an initialized OpenSpec and a built graph, and tells you which is missing. Also available to the agent as the `specDrift` tool.
- **Specs grounded in real modules.** Before a change is written up, `GET /api/stardust/context?projectRoot=<path>&files=a.js,b.js` returns the workspace's architectural hubs plus the blast radius and risk of each file the change touches, so a proposal cites modules that exist and states impact it can defend.
- **Plugins share the same graph.** Droid-Sweep finds unused files from resolved import edges rather than filename guessing, and reports whether the answer came from the graph or the text-scan fallback. Lightsaber's health score now uses real per-file test coverage, and its `test-coverage` action reports the share of source files a test actually reaches, worst-and-most-depended-on first.

### Default coding skill

Yoda-Agent loads a default coding skill for implementation work. It emphasizes explicit assumptions, simple solutions, surgical edits, matching existing style, and verifying changes with targeted tests or builds.

### Supervised agent work

Agent tasks stream task starts, tool calls, approval requests, cancellations, final answers, and errors.

**Every action that changes something pauses for your decision** — not only whole-file writes. Editing a file, patching a range, running a command, and creating or archiving an OpenSpec change all stop and wait. Reading, searching, and querying the graph run freely, because they cannot change anything and prompting for them would only train you to click through.

For a file edit you see the file as it *will be*, not the raw arguments, alongside the blast radius from the knowledge graph: what depends on it, which tests cover it, and which specs describe it. A diff says what changed; it never says what it costs.

A tool nobody has classified is treated as dangerous until someone says otherwise. See [Approvals](docs/guides/approvals.md) for the full model and how to verify it yourself.

### Persistence and audit

Task history and audit logs persist locally in SQLite (`yodaman.db`). If Node's SQLite support is unavailable, YodaMan falls back to JSON/JSONL files. Chat sessions are kept in `sessions.json`. All of these live in your data folder next to `config.json` (`~/Library/Application Support/YodaMan` on macOS, `%APPDATA%\YodaMan` on Windows, `~/.config/YodaMan` on Linux), outside the install, so upgrades keep them; the Dashboard shows the paths under **Your Data**. Clients can clear task history and audit logs through the runtime endpoints.

### Creating plugins with the CLI

YodaMan includes a `create-plugin` command to scaffold new plugins:

```bash
yodaman create-plugin my-tool
```

This generates:

- **`plugins/my-tool.js`** — plugin template with the standard YodaMan plugin interface (`name`, `description`, `permissions`, `parameters`, `execute`)
- **`plugins/my-tool.test.js`** — Jest test file with basic structure checks
- **`plugins/README.md`** — updated with an API reference entry for the new plugin

The loader skips `*.test.js` files, so the test file is never loaded as a plugin.

After scaffolding, edit the generated `.js` file to implement your tool logic, update the `parameters` and `permissions`, then run `npx jest plugins/my-tool.test.js` to verify the structure. Restart YodaMan to load it; plugins are read from `plugins/` at startup.

### Plugins

Plugins are JavaScript modules that extend the agent with custom tools. A plugin should export a `name`, `description`, `parameters`, `permissions`, and an async `execute` function. Plugin uploads, unrestricted plugins, and agent shell commands are disabled by default. Turn them on in **Settings → Developer Settings** (Plugin Uploads, Unrestricted Plugins, Agent Shell Commands) or with `YODAMAN_ALLOW_PLUGIN_UPLOADS`, `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS`, or `YODAMAN_ALLOW_AGENT_COMMANDS`, and only during trusted local support sessions. A plugin call that declares a mutating permission (`write`, `command`, `unrestricted`, and others) pauses for approval like any other change. See section 13 for writing one.

## 3. Web UI

The top bar has five tabs (**Chat**, **Graph**, **Dashboard**, **Plugins**, **Stardust**) plus **Logs** and **Settings** buttons.

- **Settings**: Open from the top-right Settings button, the sidebar plus button, or **Add directory** when no workspace exists yet. Paste an absolute path or use Browse in the desktop app, then add, edit, and stop watching workspace paths. **Open files in** chooses how search results and chat file links open: the OS default app for the file type (the default), a detected editor, or a custom command for any editor (`{file}`, `{line}` and `{column}` are filled in). **Developer Settings** holds the security switches, **Connect other agents** the MCP setup (section 7), and **View User Manual** opens this guide.
- **Workspaces sidebar**: Select a project, refresh the list, validate health, include or exclude it from context, edit the file path, remove a workspace, and run **Sync Repository** on the selected one.
- **Chat**: The Chat tab has two views. **Chat** sends tasks to Yoda-Agent; a plain search such as "find where login is handled" is answered straight from the search pipeline, and anything that needs reasoning goes to the agent. The header shows the workspace's readiness (see section 2). The dropdown above the textarea (**Insert a preset or plugin...**) inserts a **task preset**, such as **📊 Impact Analysis** (affected files, breaking changes, and tests to update), or a plugin command; nothing runs until you press Send. More presets can be added to the `TASK_PRESETS` array in `AgentChatTab.jsx`.

  Agent responses are **graph-aware**. When graph context is available, the agent cites specific files and their dependencies from the knowledge graph, and says how many files a proposed change would reach. The Graph tab shows the same graph.
- **Search**: The other Chat view. Runs semantic search across indexed code and documentation in the selected workspace. Results arrive first, then the local model writes a short summary citing them as [1], [2]. Each result has an **Open** button.
- **Dashboard**: System health with **Repair**, Context Expert and embedding configuration, vector storage, the AI Engine (model and Ollama context window), indexing, workspaces, environment, **Your Data** (where your files live), runtime diagnostics (PID, uptime, task and pending-approval counts), an on-demand **Diagnostics** report, and **Pair Mobile**.
- **Logs**: Searchable runtime logs, recent requests, index queue state, and `ctx index` output. Filter by text, level, severity, and user action, then use Copy when sharing an error. **Clear** deletes the log files (`~/.yodaman/logs/runtime.log` and its rotated copies) after asking you to confirm.
- **Manual**: **View User Manual** in Settings opens the in-app version of this guide.
- **Stardust**: OpenSpec workflow for spec-driven development: propose, validate and archive changes, draft specs for a project that has none, and see drift, coverage and impact. Includes diagnostics, version checks, and one-click OpenSpec installation (section 11).
- **Plugins**: Install `.js` or `.zip` plugins (when uploads are enabled), inspect permissions and parameters, refresh loaded plugins, and remove plugins; the five default plugins cannot be removed. The **Docs** button opens the full plugin authoring guide.

## 4. Desktop app

The Electron app starts a managed runtime sidecar when no runtime is already available on port `3090`. It also runs from the system tray.

Desktop menu (**YodaMan**) and tray actions:

- `Restart Managed Runtime` (menu and tray): Restarts the Electron-managed backend process.
- `Copy Mobile Pairing Link` (menu and tray): Creates and copies a `yodaman://pair` link.
- `Add Project Folder` (menu): Opens a native directory picker and registers the selected workspace.
- `Show YodaMan` (tray): Restores the desktop window.
- `Quit` (menu and tray): Stops the desktop app and managed runtime.

While the runtime starts, and whenever it cannot be reached, the diagnostics screen shows the YodaMan logo and version, a checklist (Node.js, Graphify, Ollama, Context Expert, OpenSpec, Config, Runtime) with install buttons for missing components, recent runtime logs, `Continue →`, `Try Again`, `Copy Error`, and `Dev Tools`.

## 5. VS Code extension

The VS Code extension provides editor-native access to the same local runtime.

Available actions (Command Palette, prefixed `YodaMan:`):

- Check runtime status, and start the runtime with the configured command (`yodaman.runtimeCommand`, default `yodaman`).
- Add a workspace by browsing for a folder, pasting a path, or using the current VS Code workspace.
- Ask about the current workspace.
- Search and reindex the current workspace.
- Open runtime logs and index queue state, and show runtime diagnostics.
- Run and cancel agent tasks, with agent events streamed to the YodaMan output channel.
- Open proposed writes as VS Code diffs, approve or reject them, and list pending approvals.
- Show the blast radius for the current file.
- Open the Stardust change board, and check (or clear) spec drift markers.
- List plugins.
- Clear task history and audit logs.
- Use the YodaMan activity bar sidebar (**Agent** view).

The default runtime URL (`yodaman.runtimeUrl`) is `http://localhost:3090`.

## 6. Mobile companion

The mobile companion pairs with the runtime using `yodaman://pair` links, or by entering the runtime URL and a pairing token. On the same network it can check status and workspace readiness, list projects, choose a workspace, ask, search, view the Stardust board, drift, compose and diagnostics, inspect task timelines, open task event details, cancel active tasks, refresh pending approvals, and approve or reject proposed writes.

The runtime listens only on `127.0.0.1` by default. For a phone to reach it, start it with `YODAMAN_HOST=0.0.0.0` and use your desktop's LAN address, for example `http://192.168.1.20:3090`. Pairing links are created on this computer only (the desktop menu or the Dashboard), and carry the desktop's LAN address in place of `127.0.0.1` or `localhost`.

## 7. Other agents (MCP)

YodaMan can lend its index to Cursor, Claude Code, Zed, and anything else that
speaks MCP. Those tools have strong models and no knowledge of your private
codebase; YodaMan has exactly that, locally.

```bash
claude mcp add yodaman -- yodaman-mcp
```

Or, for any MCP client:

```json
{ "mcpServers": { "yodaman": { "command": "yodaman-mcp" } } }
```

Five tools become available: `yodaman_projects`, `yodaman_search` (the
four-signal blend), `yodaman_graph_query`, `yodaman_impact`, and
`yodaman_spec_drift`. Reach for spec drift first — it is the thing a model
reading your repository cannot work out on its own, because it needs the specs
and the graph together.

**All five are read-only, permanently.** The approval gate protects writes made
by YodaMan's own agent; another client does not run that gate and cannot be made
to. If you want an agent to change files through YodaMan, use YodaMan's agent.

The runtime must be running — the MCP server is a thin proxy over the runtime at
`YODAMAN_URL` (`http://127.0.0.1:3090` by default). Nothing listens on a port and
nothing leaves the machine. Full details in
[MCP](docs/guides/mcp.md).

## 8. Runtime API highlights

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
- `GET /api/search/stream`: The Search view's search, as server-sent events. Same query parameters. Sends `results` (the same body as `GET /api/search`) as soon as the pipeline finishes, then `summary_start` (`model`), `summary` text pieces, and `done`. The summary is written by the local model Context Expert uses, from those results only, citing them as [1], [2]. A failed summary sends `summary_error` and leaves the results standing; a failed search sends `search_error`.
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
- `GET /api/logs`, `DELETE /api/logs`: Read or clear the runtime logs (clearing only from this computer).
- `POST /api/pairing`: Create mobile pairing links (from this computer only).

## 9. Troubleshooting

- **Something is missing but you are not sure what**: Run `yodaman doctor` for a full dependency report with per-tool install commands.
- **Context Expert not found**: Install `yodaman-ctx` (YodaMan's Context Expert) and confirm `ctx --version` works.
- **Graphify not found**: Install `graphifyy`, confirm `graphify --help` works, or set `YODAMAN_GRAPHIFY_BIN` to the executable path.
- **Graph health looks wrong**: Run `yodaman doctor --graph`, then sync the affected workspace if the command reports orphaned nodes or missing graphs.
- **Runtime unreachable**: Check port `3090`, then use `Restart Managed Runtime` or run `yodaman` from Terminal.
- **Install or Repair says it is turned off**: Turn on **Repair Can Install Missing Tools** in Settings → Developer Settings, or run the install command it shows yourself.
- **Moved repository**: Open Settings, edit the workspace path, save, then sync the repository.
- **Search results are stale**: Select the workspace and run `Sync Repository`.
- **Mobile cannot connect**: Start the runtime with `YODAMAN_HOST=0.0.0.0`, use the desktop LAN IP, confirm firewall access to port `3090`, and generate a fresh pairing link.
- **Plugin blocked**: Add explicit permissions from the allowlist to the plugin, or intentionally allow unrestricted plugins with **Unrestricted Plugins** in Settings or `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true`.
- **OpenSpec not found**: Install `@fission-ai/openspec@latest` and confirm `openspec --version` works, or click **Install Now** in Stardust → Diagnostics, or **Install OpenSpec** on the desktop startup diagnostics screen (which needs Repair turned on). `yodaman doctor` and the Dashboard health panel both report OpenSpec status.
- **Crash screen**: Use `Copy Error` to copy the exact message and recent runtime logs.

## 10. Verification and builds

Before publishing a release:

```bash
npm run release:verify   # version check, build, lint, tests, coverage, audits, smoke tests and release gates
npm run desktop:pack
cd extensions/vscode-yodaman
npm run lint
npm run package
```

## 11. Project Stardust — OpenSpec Integration

YodaMan 0.6.6 integrates OpenSpec through the **Stardust** tab. OpenSpec provides structured spec-driven development with a propose → implement → validate → archive workflow. The tab has eight views:

- **Board**: Real-time change overview with card-based navigation, task progress bars, validation health icons, and a side-by-side spec diff viewer. Select a change to review its proposed spec deltas grouped by operation (ADDED/MODIFIED/REMOVED/RENAMED), then validate or archive directly from the diff panel. The board updates live via WebSocket — file changes in `openspec/` push instantly.
- **Drift**: Architecture drift detection comparing OpenSpec specs against the knowledge graph. Shows stale spec references (files cited in specs that no longer exist) and undocumented modules (load-bearing files no spec describes). Unique to YodaMan.
- **Compose**: File-centric cross-reference. Enter any repo path to see which OpenSpec specs describe it, its Graphify structural position (dependents, centrality, blast radius, test coverage), and how Context Expert ranks it — three columns, one file.
- **Trust**: Unified health dashboard across Context Expert, Graphify, and OpenSpec with per-tool status cards and the overall WorkspaceReadiness verdict.
- **Trace**: Search ranking transparency. Every search result shows its semantic×0.50 + proximity×0.20 + centrality×0.15 + specCoverage×0.15 breakdown with colour-coded bars for each signal and a spec coverage indicator showing which OpenSpec specs describe the file.
- **Diagnostics**: Installation check, version, whether `openspec/config.yaml` exists, and **Run Diagnostics**, **Install Now** and **Initialize Project** buttons.
- **Commands**: Direct CLI access with Propose, Validate, Archive, List Changes, List Specs and Draft Specs buttons plus a scrollable console output. The Propose button creates `openspec/changes/<name>/` with proposal.md, design.md, and tasks.md.
- **Impact**: Dedicated blast-radius analysis with configurable hop depth and spec awareness. Enter any file path to see dependents, test coverage, and which OpenSpec specs describe it.

### Setup

```bash
npm install -g @fission-ai/openspec@latest
```

### Workflow

A project with no specs yet can start with **Draft Specs** (next section).

1. **Propose**: Enter a change name (for example `add-auth-middleware`) in the Commands tab and click **Propose**. Stardust creates `openspec/changes/<name>/` with template `proposal.md`, `design.md` and `tasks.md`. It does not read your code or write specs: fill in the templates, and describe the requirements the change adds, modifies or removes as spec deltas under `openspec/changes/<name>/specs/`.
2. **Implement**: Make the change yourself or with Yoda-Agent, ticking off `tasks.md` as you go.
3. **Validate**: Runs `openspec validate <name>` to check the change and its spec deltas.
4. **Archive**: Runs `openspec archive <name>`. The change moves to the archive and its spec deltas are merged into `openspec/specs/`. This is how specs are created and updated.

There is no separate Apply step: archiving a change is what applies its spec deltas.

### Draft specs for an existing project

A project with code but no specs can get a first set from **Commands → Draft Specs** (or by typing `Draft baseline specs` in Chat). YodaMan:

1. Groups the code into capabilities by top-level module (for example `backend/core` becomes `backend-core`), using the Graphify graph and putting the modules most of the code depends on first. Up to six capabilities, tests left out.
2. Retrieves each capability's key code through the search pipeline (Context Expert, ranked by Graphify).
3. Asks your local model (through Context Expert and Ollama; nothing leaves your machine) to write requirements in OpenSpec's format: `### Requirement:` blocks with SHALL statements and `#### Scenario:` blocks.

Nothing is written until you approve it. Chat asks first to run `openspec init` (only if `openspec/` is missing; no AI-tool files are added), then shows each `openspec/specs/<capability>/spec.md` as a diff with its blast radius. Reject a draft and it is not written. An existing spec is never replaced, and a capability the model could not describe is skipped and named in the answer.

Every draft says **DRAFT** in its Purpose section. Read and edit them before you rely on them, then run `openspec validate --specs`. Drafting needs a built graph (run Sync Repository first) and takes about a minute per capability on a 9B model.

### Diagnostics

The Stardust tab includes a Diagnostics panel that checks:
- OpenSpec installation status
- Current OpenSpec version
- Whether `openspec/config.yaml` exists in your workspace

**Install Now** runs `npm install -g @fission-ai/openspec`, with the same gate as Repair: only when **Repair Can Install Missing Tools** is on in Settings, and only from this computer. **Initialize Project** runs `openspec init --tools all`, which also writes OpenSpec's AI-tool files; the Draft Specs flow initializes with `--tools none`.

### Agent Tools

The Yoda-Agent has five OpenSpec tools available during autonomous tasks:

- `specPropose(project, changeName, description)` — Creates a new change proposal under `openspec/changes/<name>/`.
- `specDraft(project, maxCapabilities)` — Drafts baseline specs for a project with none, as described above. It writes nothing; the agent saves each draft with `writeFile`, which asks for approval.
- `specValidate(project, changeName)` — Validates a change against project specs via the CLI.
- `specArchive(project, changeName)` — Archives a completed change.
- `specDrift(project)` — Compares OpenSpec intent against the actual knowledge graph.

The agent is instructed to follow the Propose → Validate → Archive workflow for any significant feature, and to check drift before proposing new work.

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

## 12. How the agent uses the three tools

Context Expert has no session, so every reasoning step re-sends the conversation. Three mechanisms keep that affordable and keep all three tools in the loop:

- **Stardust brief**: built once at the start of each task from all three tools: graph size and busiest modules, the spec list and current drift, and for every file the task names, its blast radius, covering tests and describing specs. From `GRAPH_REPORT.md` it keeps only the sections that carry information (God Nodes, Surprising Connections).
- **Bounded transcript**: tool results are clipped on arrival, the newest turns stay verbatim, and older turns collapse to one line each recording which tool ran and how it ended. The original task is never elided. The prompt budget grows with the context window Ollama serves, and `YODAMAN_AGENT_PROMPT_CHARS`, when set, replaces it with a fixed number of characters (at most 120,000).
- **Scoped retrieval**: each `ctx ask` is scoped to the active workspace with `-p`, so retrieval runs against one project rather than every indexed project at once.

The agent also has `impactOf(file, project, depth)`, which returns a file's dependents, covering tests, risk and describing specs from an in-process graph read. It is the same assessment the approval prompt shows you, made available to the model *before* it proposes a change.

Tool signatures reaching the model are typed, with `?` marking optional parameters (`searchCode(query: string (natural language or a code fragment), project?: string, ...)`), so parameter meaning does not have to be inferred from the name alone.

## 13. Writing a plugin

A plugin is one CommonJS file in `plugins/`. The in-app guide (Plugins → Docs) covers this in full with copy-ready examples; the contract is:

```javascript
module.exports = {
    name: 'Kyber-Count',                 // required: the tool name the model emits
    description: 'What it does. 💡 Chat usage: "count the lines in this project"',
    permissions: ['read'],               // required for uploads; allowlisted values only
    parameters: {
        workspacePath: { type: 'string', required: true, description: 'Absolute path' }
    },
    async execute(params = {}) {         // required: returns a JSON-serializable result
        return { fileCount: 0 };
    }
};
```

- **Allowed permissions**: `read`, `write`, `command`, `network`, `search`, `graphify:read`, `git:read`, `agent:invoke`, `task:create`, `audit:write`, `upload:temp`, `filesystem:read-selected`, `desktop:openFile`, `storage:indexeddb`, `webxr`, `speech`, `unrestricted`. Anything else stops the plugin from loading. Omitting the array means `unrestricted`, which is refused at call time unless Unrestricted Plugins is enabled in Settings, and uploads reject it outright.
- **The description is the prompt.** The model sees `name(param: type (description), ...)` and your description, capped at 300 characters. A small model served through a small context window sees only the signature. Put the meaning, and the phrases a user would type, early in the description.
- **Keep results small.** The return value is serialized into the model's context. Cap arrays and return counts with a truncated sample.
- **Prefer the graph.** `require('../backend/infrastructure/GraphFacts')` answers structural questions from resolved import edges instead of a filesystem scan.
- **Lifecycle form**: exporting `onLoad`/`onEnable`/`onDisable`/`onUnload` instead of `execute` gets a `PluginAPI` instance with `log`, `ui`, `fetch`, `worker` and `config`.
- **Verify**: `node -e "const t=require('./backend/infrastructure/ToolBox');console.log([...t.plugins.keys()])"`
