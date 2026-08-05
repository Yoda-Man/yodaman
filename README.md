# YodaMan

YodaMan is your code's memory palace. Private. Extensible. Graph-powered. It connects your projects, semantic search, agent tasks, approvals, plugins, desktop controls, VS Code, and mobile companion flows around one private local runtime — with a real-time Stardust OpenSpec dashboard, cross-tool composition views, and agent-driven spec workflows.

![Version](https://img.shields.io/badge/Version-0.4.3-gold)
![License](https://img.shields.io/badge/License-MIT-green)

## Why YodaMan

- **Keep code private**: Designed around local project indexing and local model workflows through Context Expert and optional Ollama. No code leaves your machine.
- **Understand the whole workspace**: Search and ask across indexed repositories instead of juggling isolated editor tabs.
- **See relationships, not fragments**: Graphify builds mandatory knowledge graphs that connect code, docs, diagrams, and architectural concepts.
- **Delegate carefully**: Run agent tasks with streamed progress, persisted task history, cancellation, audit logs, and approval gates for file changes.
- **Work where you already are**: Web UI, desktop app, CLI, VS Code extension, and mobile companion all talk to the same runtime.
- **Extend the assistant**: Add JavaScript plugins for custom tools. Ships with 7 plugins: CodeTrooper, Droid-Sweep, Grand Inquisitor, Lightsaber, Graphify, Holocron VR, and the plugin registry.
- **Drive specs with the agent**: The agent can propose, validate, and archive OpenSpec changes through `specPropose`, `specValidate`, and `specArchive` tools — following a structured Propose → Apply → Archive workflow.
- **See every tool's view of a file**: The Compose tab cross-references any file across OpenSpec (specs), Graphify (structure), and Context Expert (relevance) in three columns.
- **Understand search rankings**: The Trace tab shows why each result ranked where it did — semantic × 0.6 + proximity × 0.25 + centrality × 0.15 per result.
- **Choose query intent**: Switch between Code and Docs modes for more relevant answers.
- **Recover gracefully**: All clients show clear recovery guidance when the local service is unavailable.

## Core Pillars

### Local-first intelligence
Project context stays on your machine. Watched directories in `config.json` are indexed locally and reused by chat, search, agent tasks, and external clients.

### Human-controlled automation
The agent reasons through multi-step coding work, but write proposals require human approval. Events stream: `task_started`, tool activity, approvals, cancellation, final answers, errors.

### One ecosystem runtime
The Express runtime is the shared contract for the React UI, Electron desktop shell, VS Code extension, mobile app, and CLI. Each client can ask, search, reindex, inspect tasks, and participate in approvals.

### Extensible tools
Built-in tools cover file reads, controlled writes, exact patching, command execution, search, and file listing. Plugin tools in `plugins/` extend functionality with declared permissions.

## Sub-Projects

| Project | Location | Description |
|---------|----------|-------------|
| **YodaMan Core** | `core/` | Main Express runtime, React UI, agent engine, plugins |
| **Lightsaber** | `lightsaber/` | Git health map plugin — code hotspot analysis |
| **Holocron VR** | `Holocron VR/` | 3D VR codebase explorer (community plugin) |

## Prerequisites

- Node.js 18+
- Python 3.10+
- Context Expert CLI: `npm install -g @contextexpert/cli`
- OpenSpec CLI: `npm install -g @fission-ai/openspec@latest`
- Graphify: `pip install graphifyy`
- Ollama (for local model execution)

## Quick Start

```bash
git clone https://github.com/Yoda-Man/yodaman.git
cd yodaman/core
sh setup.sh
```

The runtime listens on `http://localhost:3090`. For the desktop app:

```bash
npm run desktop
```

## Health Checks

Verify every required dependency — Ollama, Context Expert (`ctx`), Graphify, and OpenSpec — before starting:

```bash
yodaman doctor
```

Each tool reports its version, resolved path, and reachability, and anything missing lists the install command for your platform. The command exits non-zero when a dependency is missing or unreachable, so it can gate a script or CI step; add `--json` for machine-readable output. To check knowledge graph freshness instead:

```bash
yodaman doctor --graph
```

The same dependency checks run at startup, appear in the Dashboard health panel and `GET /api/health`, and appear on the desktop startup diagnostics screen where missing components offer a one-click install.

## Key Technologies

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js/Express |
| Frontend | React 18 + Vite + Tailwind CSS |
| AI/LLM | Ollama (qwen3.5:9b) |
| Embeddings | HuggingFace (BAAI/bge-large-en-v1.5) |
| Knowledge Graph | Graphify |
| Code Indexing | Context Expert (ctx) |
| Desktop | Electron |
| Mobile | React Native (companion) |
| VS Code | Extension API |
| Database | SQLite + JSON/JSONL fallback |
| Git | simple-git |

## Project Structure

```
yodaman/
├── backend/                    # Express runtime
│   ├── core/                   # Agent engine, queue service, coding skill
│   ├── infrastructure/         # ToolBox, Graphify, ContextEngine, Logger, GraphFacts, ImpactAnalyzer, etc.
│   ├── interfaces/             # REST controller (all API routes, ~2300 lines)
│   ├── services/               # Git, search, file upload
│   ├── stardust/               # SpecDrift, StardustWrapper (CLI), StardustLive (WebSocket)
│   └── utils/                  # Doc preprocessing, query classification
├── bin/                        # CLI entrypoint (yodaman)
├── dist/                       # Built frontend
├── electron/                   # Desktop app shell
├── extensions/vscode-yodaman/  # VS Code extension
├── frontend/                   # Shared frontend utilities + Holocron VR plugin UI
├── plugins/                    # Installed plugins (CodeTrooper, Droid-Sweep, etc.)
├── scripts/                    # Build and release scripts
├── shared/                     # Shared protocol/types for external clients
├── src/                        # React UI source
│   ├── components/             # 26 UI components (Stardust, AgentChat, GraphStudio, etc.)
│   ├── hooks/                  # useHealthCheck, useStardustLive, useStardustPipeline
│   └── api/                    # Frontend HTTP client
├── tests/                      # Jest test suites
├── website/                    # Public website + downloads
├── server.js                   # Express entry point
├── start.js                    # CLI launcher
└── package.json
```

### Before deleting anything

Much of this codebase is reached without a static import: plugins are `require()`d
from a computed path, plugin UI components are named as strings in
`plugins/plugin.json`, and several files are entry points launched by a host
rather than imported. Tools that build an import graph report all of it as dead.
## Configuration

Copy `config.example.json` to `config.json` and add your workspace paths:

```json
{
  "watchedDirectories": ["/path/to/your/project"],
  "removedDirectories": []
}
```

All developer settings (plugin uploads, unrestricted plugins, agent commands) are managed through Settings → Developer Settings in the UI.

## Stardust Dashboard

The **Stardust** tab is a real-time OpenSpec dashboard with 7 views:
- **Board** — live change cards with task progress, spec diff, validate/archive workflow
- **Drift** — architecture drift detection (specs vs knowledge graph)
- **Compose** — file-centric cross-reference across OpenSpec, Graphify, and Context Expert
- **Trust** — unified health dashboard with per-tool status and WorkspaceReadiness verdict
- **Trace** — search ranking transparency with per-result scoring breakdown
- **Diagnostics** — OpenSpec install check, version, project init
- **Commands** — Propose, Validate, Archive, List Changes, List Specs with console output

The agent has four OpenSpec tools: `specPropose`, `specValidate`, `specArchive`, and `specDrift`.

## Clients

- **Web UI**: React control center at `http://localhost:3090`
- **Desktop app**: Electron shell with managed runtime
- **VS Code extension**: Editor-native access from the command palette
- **Mobile companion**: React Native app for task monitoring and approvals

## License

MIT
