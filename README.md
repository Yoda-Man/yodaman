# YodaMan

YodaMan is a local-first AI workspace companion for developers. It connects your projects, semantic search, agent tasks, approvals, plugins, desktop controls, VS Code, and mobile companion flows around one private runtime.

![Version](https://img.shields.io/badge/Version-0.1.7-gold)
![License](https://img.shields.io/badge/License-MIT-green)

## Why YodaMan

- **Keep code private**: YodaMan is designed around local project indexing and local model workflows through Context Expert and optional Ollama.
- **Understand the whole workspace**: Search and ask across indexed repositories instead of juggling isolated editor tabs.
- **Delegate carefully**: Run agent tasks with streamed progress, persisted task history, cancellation, audit logs, and approval gates for file changes.
- **Work where you already are**: Use the web UI, desktop app, CLI package, VS Code extension, and mobile companion surfaces against the same runtime.
- **Extend the assistant**: Add JavaScript plugins for custom tools while keeping tool activity visible through policy and audit endpoints.

## Core Pillars

### Local-first intelligence

Project context starts on your machine. Watched directories are stored in `config.json`, indexed locally, and reused by chat, search, agent tasks, and external clients.

### Human-controlled automation

The agent can reason through multi-step coding work, but write proposals require review. Runtime events expose `task_started`, tool activity, approvals, cancellation, final answers, and errors so clients can stay transparent.

### One ecosystem runtime

The Express runtime is the shared contract for the React UI, desktop shell, VS Code extension, mobile app, and CLI package. Each client can ask, search, reindex, inspect task state, and participate in approvals.

### Extensible tools

Built-in tools cover file reads, controlled writes, exact patching, command execution, search, and file listing. Plugin tools can be dropped into `plugins/`, and declared permissions keep risky tools visible and restricted.

## Prerequisites

- Node.js 18 or newer
- Context Expert CLI:

```bash
npm install -g @contextexpert/cli
```

- Ollama, optional but recommended for local model execution

## Setup

```bash
git clone https://github.com/Yoda-Man/yodaman.git
cd yodaman
npm install
sh setup.sh
```

Add or update watched project directories in `config.json`:

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ]
}
```

## Run

Start the local runtime and web UI:

```bash
npm start
```

This checks that `ctx` is available, then runs the backend and Vite client. The runtime listens on `http://localhost:3090`, and the dev UI is available at `http://localhost:5190`.

You can also run the dev command directly:

```bash
npm run dev
```

## Common Commands

```bash
npm run build        # Build the React app
npm test             # Run Jest tests
npm run desktop      # Build and launch the Electron app
npm run desktop:pack # Create an unpacked desktop build
```

The npm CLI entrypoint is `yodaman` after installation from the package.

Generated local state files such as `audit-log.json`, `audit-log.jsonl`, `task-history.json`, and `task-history.jsonl` are ignored by git.

Run release smoke checks before packaging:

```bash
npm run release:smoke
```

## Clients

- **Web UI**: React control center for projects, chat, search, plugins, approvals, and status.
- **Desktop app**: Electron shell for the same control center with desktop packaging.
- **VS Code extension**: Editor-native status, ask, search, reindex, agent tasks, and diff approval.
- **Mobile app**: Companion app for pairing, project status, task timelines, approvals, search, and prompts.

## License

MIT
