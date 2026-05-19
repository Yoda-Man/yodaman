# YodaMan User Manual

YodaMan is a local-first AI workspace companion for developers. It keeps project context on your machine, helps you search and ask across indexed repositories, and lets you supervise agent tasks from the web UI, desktop app, VS Code, and mobile companion.

## 1. Setup

Install prerequisites:

```bash
npm install -g @contextexpert/cli
```

Then start YodaMan from the project root:

```bash
npm install
sh setup.sh
npm start
```

The backend runtime listens on `http://localhost:3090`. The development web UI listens on `http://localhost:5190`.

Add watched workspaces in `config.json`:

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ]
}
```

## 2. Core Ideas

### Local-first intelligence

YodaMan indexes local project folders and routes chat, search, and agent workflows through the local runtime.

### Human-controlled automation

Agent tasks stream every important event: task start, tool activity, approval requests, cancellation, final answers, and errors. File writes require human approval.

### Shared ecosystem runtime

The web UI, Electron desktop app, VS Code extension, and mobile app use the same runtime APIs for projects, search, ask, task timelines, approvals, policy, audit, and pairing.

### Restricted plugins

Plugins declare permissions such as `read`, `write`, `command`, `network`, or `search`. Uploaded plugins must include a `permissions` array. Unrestricted plugins are blocked unless you explicitly start the runtime with `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true`.

## 3. Web UI

- **Projects**: Add watched folders, select the current workspace, and queue reindexing.
- **Chat**: Ask questions about the selected project.
- **Search**: Run semantic search against all indexed code or a selected project.
- **Dashboard**: View system status, runtime diagnostics, task counts, pending approvals, and create a mobile pairing link.
- **Plugins**: Install JavaScript plugins and inspect their declared permissions.
- **Manual**: Open the in-app guide.

## 4. Agent Tasks

When you run an agent task, YodaMan stores recent task state and events in `task-history.json` and appends changes to `task-history.jsonl`. This means task timelines survive runtime restarts.

Approval flow:

1. The agent proposes a write.
2. YodaMan emits an `awaiting_approval` event.
3. A client shows the diff or pending approval.
4. You approve or reject.
5. The agent continues with that decision.

You can cancel an active task from clients that expose task cancellation.

## 5. Desktop App

Run the desktop shell:

```bash
npm run desktop
```

The Electron app starts the backend as a sidecar when no runtime is already running. The desktop menu includes:

- `Restart Managed Runtime`
- `Copy Mobile Pairing Link`
- `Add Project Folder`

The dashboard also exposes runtime diagnostics and mobile pairing. The desktop app shows native notifications when a task needs approval or completes.

## 6. VS Code Extension

The extension can:

- Check runtime status.
- Start the configured runtime command.
- Ask about the current workspace.
- Search and reindex the current workspace.
- Run agent tasks.
- Show streamed events in the YodaMan output channel.
- Open proposed writes as VS Code diffs.
- Approve, reject, or cancel agent work.

The default runtime URL is `http://localhost:3090`.

## 7. Mobile Companion

The mobile app can:

- Parse `yodaman://pair` links.
- Check runtime status.
- List projects and select one.
- Ask/search against the selected project.
- Inspect recent task timelines.
- Open full event details from a task timeline.
- Cancel active tasks.
- Refresh pending approvals.
- Approve or reject proposed writes.

For a phone on the same network, use your desktop machine LAN address, for example `http://192.168.1.20:3090`.

## 8. Troubleshooting

- **Context Expert not found**: Install `@contextexpert/cli` and confirm `ctx --version` works.
- **Runtime unreachable**: Check that port `3090` is available and the backend is running.
- **Web UI unreachable**: Check that Vite is running on port `5190` during development.
- **Search results are stale**: Reindex the selected workspace.
- **Mobile cannot connect**: Use the desktop LAN IP, confirm firewall access to port `3090`, and generate a fresh pairing link.
- **Plugin blocked**: Add explicit permissions to the plugin or intentionally allow unrestricted plugins with `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true`.

## 9. Verification

Before packaging or publishing, run:

```bash
npm test
npm run build
npm run release:smoke
```
