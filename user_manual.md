# YodaMan User Manual

Version: 0.2.1

YodaMan is a local-first AI workspace companion for developers. It keeps project context on your machine and exposes that context through the web UI, desktop app, VS Code extension, mobile companion, mandatory Graphify knowledge graph, plugin system, and local runtime API.

## 1. Setup

Install Context Expert and Graphify, then install and start YodaMan from the project root:

```bash
npm install -g @contextexpert/cli
python3 -m pip install graphifyy
npm install
sh setup.sh
npm start
```

The runtime listens on `http://localhost:3090`. The development web UI listens on `http://localhost:5190`.

For desktop use:

```bash
npm run desktop
```

## 2. Core concepts

### Local runtime

The Express runtime is the shared contract for every client. It serves the React UI, exposes project/search/chat/task/plugin endpoints, uses Context Expert for code and documentation intelligence, and requires Graphify for graph-aware answers.

### Workspaces

Workspaces are absolute local folder paths. Add them by pasting a path, browsing with a native folder picker in desktop clients, using the sidebar plus button, or using the desktop menu item `Add Project Folder`. In version 0.2.1 you can edit a workspace path when a project moves, delete stale workspaces, validate workspace health, refresh the workspace list, and run `Sync Repository` to reindex the active workspace and update its Graphify graph.

### Graphify knowledge graph

Graphify is mandatory in 0.2.1 and runs local-only through Ollama for semantic extraction. YodaMan strips cloud provider API keys from Graphify subprocesses and forces the Ollama backend when full extraction is enabled. Reindexing builds or updates `graphify-out/graph.json` and `GRAPH_REPORT.md` for each workspace and adds the project graph to Graphify's global graph. Chat and agent answers include graph report context plus question-specific graph traversal output, and stale graphs rebuild before answer context is gathered.

The Graph tab opens Graph Studio, a project-scoped visual workspace for Graphify outputs. Graph Studio embeds the generated mind-map and Vis.js canvas artifacts, shows graph freshness, renders the markdown report, and keeps graph query plus impact analysis actions close to the visualization.

### Default coding skill

Yoda-Agent loads a default coding skill for implementation work. It emphasizes explicit assumptions, simple solutions, surgical edits, matching existing style, and verifying changes with targeted tests or builds.

### Supervised agent work

Agent tasks stream task starts, tool calls, approval requests, cancellations, final answers, and errors. File writes are human controlled: clients show proposed changes and require approval or rejection before the agent continues.

### Persistence and audit

Task history and audit logs persist locally in SQLite when available. If Node SQLite support is unavailable, YodaMan falls back to JSON/JSONL files. Clients can clear task history and audit logs through the runtime endpoints.

### Plugins

Plugins are JavaScript modules that extend the agent with custom tools. A plugin should export a `name`, `description`, `parameters`, `permissions`, and an async `execute` function. Plugins without explicit permissions are treated as unrestricted and are blocked unless `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true` is set for trusted code.

## 3. Web UI

- **Settings**: Open from the top-right Settings button, sidebar plus button, or Configuration modal. Paste an absolute path or use Browse in the desktop app, then add, edit, and delete workspace paths.
- **Workspaces sidebar**: Select a project, refresh the list, validate health, toggle inclusion, edit the file path, delete a workspace, and sync the selected repository.
- **Chat**: Ask questions using the selected workspace context.
- **Search**: Run semantic search across indexed code and documentation, optionally scoped to the selected workspace.
- **Dashboard**: View runtime status, database/index metrics, environment information, runtime diagnostics, task counts, pending approvals, plugin policy information, and mobile pairing.
- **Logs**: Open recent runtime logs, reindex requests, index queue state, and `ctx index` output. Use Copy when sharing an error.
- **Manual**: Read the in-app version of this guide.
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
- `GET /api/search`: Run semantic search.
- `POST /api/ask`: Ask a question.
- `GET /api/status`: Read Context Expert status.
- `GET /api/desktop/diagnostics`: Read runtime, task, host, and plugin diagnostics.
- `GET /api/plugins`, `POST /api/plugins`, `DELETE /api/plugins/:name`: Manage plugins.
- `GET /api/agent/tasks`, `DELETE /api/agent/tasks`: Inspect or clear task history.
- `POST /api/agent/task`, `POST /api/agent/approve`, `POST /api/agent/cancel`: Run, approve, reject, or cancel agent work.
- `GET /api/audit`, `DELETE /api/audit`: Inspect or clear audit logs.
- `POST /api/pairing`: Create mobile pairing links.

## 8. Troubleshooting

- **Context Expert not found**: Install `@contextexpert/cli` and confirm `ctx --version` works.
- **Graphify not found**: Install `graphifyy`, confirm `graphify --help` works, or set `YODAMAN_GRAPHIFY_BIN` to the executable path.
- **Runtime unreachable**: Check port `3090`, then use `Restart Managed Runtime` or run `yodaman` from Terminal.
- **Moved repository**: Open Settings, edit the workspace path, save, then sync the repository.
- **Search results are stale**: Select the workspace and run `Sync Repository`.
- **Mobile cannot connect**: Use the desktop LAN IP, confirm firewall access to port `3090`, and generate a fresh pairing link.
- **Plugin blocked**: Add explicit permissions to the plugin or intentionally allow unrestricted plugins with `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true`.
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
