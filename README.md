# YodaMan

YodaMan is a local-first AI workspace companion for developers. It connects your projects, semantic search, agent tasks, approvals, plugins, desktop controls, VS Code, and mobile companion flows around one private runtime.

![Version](https://img.shields.io/badge/Version-0.2.1-gold)
![License](https://img.shields.io/badge/License-MIT-green)

## Why YodaMan

- **Keep code private**: YodaMan is designed around local project indexing and local model workflows through Context Expert and optional Ollama.
- **Understand the whole workspace**: Search and ask across indexed repositories instead of juggling isolated editor tabs.
- **See relationships, not fragments**: Graphify builds mandatory knowledge graphs that connect code, docs, diagrams, and architectural concepts.
- **Delegate carefully**: Run agent tasks with streamed progress, persisted task history, cancellation, audit logs, and approval gates for file changes.
- **Work where you already are**: Use the web UI, desktop app, CLI package, VS Code extension, and mobile companion surfaces against the same runtime.
- **Extend the assistant**: Add JavaScript plugins for custom tools while keeping tool activity visible through policy and audit endpoints.
- **Choose query intent**: Switch between code and documentation modes so answers and search flows match the kind of context you need.
- **Recover gracefully**: Desktop, web, VS Code, and mobile clients show clear runtime recovery guidance when the local service is unavailable.

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
- Python 3.10 or newer
- Context Expert CLI:

```bash
npm install -g @contextexpert/cli
```

- Graphify knowledge graph CLI:

```bash
python3 -m pip install graphifyy
```

- Ollama is required for local model execution. Graphify runs through Ollama only; YodaMan strips cloud provider API keys from Graphify subprocesses.

- Ollama, required for local model execution

## Dependencies

Runtime dependencies include Express for the local API, React and Vite for the web UI, Context Expert (`ctx`) for workspace intelligence, Graphify (`graphify`, installed from the `graphifyy` Python package) for mandatory knowledge graph construction and graph-aware answer context, Chokidar for file watching, Multer for plugin uploads, and Lucide React for UI icons. Development and packaging use Jest, Electron, Electron Builder, Tailwind CSS, PostCSS, Nodemon, Concurrently, and the release smoke-check script.

Graphify is wired into YodaMan as a required knowledge layer. Reindexing a workspace updates both the Context Expert index and the Graphify graph, then adds the project graph to Graphify's global graph. Chat and agent answers receive graph report context plus question-specific graph traversal output; stale graphs rebuild before answer context is gathered. The Graph tab opens Graph Studio, a dedicated project-scoped surface for interactive Graphify visualizations, graph reports, graph queries, and impact analysis. Runtime clients can also call `/api/graphify/status`, `/api/graphify/build`, `/api/graphify/artifact`, `/api/graphify/report`, `/api/graphify/query`, `/api/graphify/explain`, `/api/graphify/path`, `/api/graphify/affected`, `/api/graphify/map`, and `/api/graphify/tree`.

Yoda-Agent also loads a default coding skill inspired by the Karpathy-style guidance for AI coding agents: surface assumptions, keep changes small, avoid speculative abstractions, make surgical edits, and verify work with targeted checks.

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

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `YODAMAN_PORT` | `3090` | Backend runtime port. |
| `VITE_YODAMAN_API_BASE` | `/api` | Frontend API base path for alternate hosts or proxies. |
| `VITE_YODAMAN_FETCH_TIMEOUT_MS` | `30000` | Browser request timeout. |
| `YODAMAN_REQUIRE_PAIRING_TOKEN` | `false` | Requires `X-YodaMan-Token` for non-local API clients when set to `true`. |
| `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS` | `false` | Allows explicitly trusted unrestricted plugins. |
| `YODAMAN_GRAPHIFY_BIN` | `graphify` | Graphify CLI binary used to build and query workspace knowledge graphs. |
| `YODAMAN_GRAPHIFY_TIMEOUT_MS` | `120000` | Timeout for Graphify build and query subprocesses. |
| `YODAMAN_GRAPHIFY_FULL_EXTRACT` | `false` | Use Graphify full semantic extraction through Ollama only. |
| `YODAMAN_GRAPHIFY_OLLAMA_MODEL` | `qwen3:5b` | Ollama model passed to Graphify when full extraction is enabled. |

## Query Modes

YodaMan supports two query modes from the chat toolbar and `/api/mode`:

- `code`: prioritizes source-oriented answers and searches.
- `doc`: preprocesses Markdown, reST, text, AsciiDoc, and JSDoc into indexable documentation chunks before documentation search.

The selected mode is stored in browser local storage and sent with `/api/ask` requests. See [docs/QUERY_MODE.md](docs/QUERY_MODE.md) for the API contract and troubleshooting notes.

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

## Operations

Health and support endpoints are available at `/api/status`, `/api/check?path=...`, `/api/desktop/diagnostics`, `/api/policy`, and `/api/audit`. Runtime logs are emitted as structured JSON with request IDs, and responses include `X-Request-Id` for support correlation.

Operational runbooks live in [docs/runbooks.md](docs/runbooks.md). Configuration details live in [docs/configuration.md](docs/configuration.md), and the ecosystem overview is in [docs/ecosystem-architecture.md](docs/ecosystem-architecture.md).

## Clients

- **Web UI**: React control center for projects, chat, search, plugins, approvals, and status.
- **Desktop app**: Electron shell for the same control center with desktop packaging.
- **VS Code extension**: Editor-native status, ask, search, reindex, agent tasks, and diff approval.
- **Mobile app**: Companion app for pairing, project status, task timelines, approvals, search, and prompts.

The desktop app starts the managed runtime automatically. If the service cannot start, it stays open with a recovery screen, runtime logs, and restart guidance instead of closing unexpectedly.

## License

MIT
