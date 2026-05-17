# YodaMan VS Code Extension

This is the first editor-native client for the YodaMan runtime.

## Current MVP

- Connects to a local YodaMan runtime.
- Starts the runtime with the configured `yodaman.runtimeCommand`.
- Shows runtime availability in the status bar.
- Adds a YodaMan Activity Bar view with runtime, workspace, task state, and quick actions.
- Runs workspace questions through `/api/ask`.
- Searches the workspace through `/api/search`.
- Queues workspace reindexing through `/api/reindex`.
- Runs agent tasks through `/api/agent/task`.
- Streams task events into a `YodaMan` output channel.
- Opens write proposals as VS Code diffs against the real target file when it exists.
- Sends approval or rejection to `/api/agent/approve`.
- Cancels the active task through `/api/agent/cancel`.

## Development

1. Start the YodaMan runtime from the repository root:

   ```bash
   npm start
   ```

2. Open `extensions/vscode-yodaman` in VS Code.
3. Press F5 to launch an extension development host.

The default runtime URL is `http://localhost:3090`. Change `yodaman.runtimeUrl` in VS Code settings if needed.

Use `YodaMan: Start Local Runtime` if the runtime is not already running. The default command is `yodaman`; change `yodaman.runtimeCommand` if you prefer a repo-local command such as `npm start`.

## Commands

- `YodaMan: Check Runtime Status`
- `YodaMan: Start Local Runtime`
- `YodaMan: Ask About Workspace`
- `YodaMan: Search Workspace`
- `YodaMan: Reindex Workspace`
- `YodaMan: Run Agent Task`
- `YodaMan: Cancel Active Agent Task`
