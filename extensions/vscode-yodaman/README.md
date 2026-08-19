# YodaMan VS Code Extension

This is the first editor-native client for the YodaMan runtime.

## Current MVP

- Connects to a local YodaMan runtime.
- Starts the runtime with the configured `yodaman.runtimeCommand`.
- Shows runtime availability in the status bar.
- Adds a YodaMan Activity Bar view with runtime, workspace, task state, and quick actions.
- Adds workspaces by browsing for a folder, pasting an absolute path, or registering the current VS Code workspace.
- Runs workspace questions through `/api/ask`.
- Searches the workspace through `/api/search`.
- Queues workspace reindexing through `/api/reindex`.
- Opens runtime logs and index queue state from `/api/logs`.
- Runs agent tasks through `/api/agent/task`. The web UI includes a **task presets** dropdown with a **📊 Impact Analysis** template that pre-fills a prompt for affected files, breaking changes, and suggested tests — toggle to the web UI's Agent Chat tab to use it directly.
- Streams task events into a `YodaMan` output channel.
- Opens write proposals as VS Code diffs against the real target file when it exists.
- Sends approval or rejection to `/api/agent/approve`.
- Cancels the active task through `/api/agent/cancel`.
- Uses the shared YodaMan API/SSE client and protocol declarations from the repository `shared/` package.

## Development

1. Start the YodaMan runtime from the repository root:

   ```bash
   npm start
   ```

2. Open `extensions/vscode-yodaman` in VS Code.
3. Press F5 to launch an extension development host.

The default runtime URL is `http://localhost:3090`. Change `yodaman.runtimeUrl` in VS Code settings if needed.

Use `YodaMan: Start Local Runtime` if the runtime is not already running. The default command is `yodaman`; change `yodaman.runtimeCommand` if you prefer a repo-local command such as `npm start`.

Task state and event history now come from the persisted runtime task history, so recent timelines can survive runtime restarts.

## Commands

### Agent

- `YodaMan: Ask About Workspace`
- `YodaMan: Run Agent Task`
- `YodaMan: Cancel Active Agent Task`
- `YodaMan: Search Workspace` — ranked results open the file; the blended score
  and OpenSpec coverage ride along so the ranking stays inspectable.

### The three-tool pillar

- `YodaMan: Blast Radius For This File` — dependents, centrality, spec coverage,
  and test coverage for the active file. Also on the editor and explorer context
  menus.
- `YodaMan: Stardust Change Board` — active OpenSpec changes and graph freshness.
- `YodaMan: Check Spec Drift` — publishes drift into the Problems panel as
  diagnostics. Stale spec references land on the spec; undocumented load-bearing
  modules land on the module.
- `YodaMan: Clear Spec Drift Markers`
- `YodaMan: Pending Approvals` — review and decide write proposals.
- `YodaMan: Runtime Diagnostics` — pillar tool health, Ollama, and per-workspace
  readiness with the remediation each stale workspace needs.
- `YodaMan: List Plugins`

### Runtime and workspace

- `YodaMan: Check Runtime Status`
- `YodaMan: Start Local Runtime`
- `YodaMan: Add Workspace`
- `YodaMan: Add Workspace From Path`
- `YodaMan: Reindex Workspace`
- `YodaMan: Open Runtime Logs`
- `YodaMan: Clear Task History`
- `YodaMan: Clear Audit Logs`
