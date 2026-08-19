# YodaMan

YodaMan is local-first workspace intelligence for developers. **Context Expert** (semantic search), **Graphify** (structure), and **OpenSpec** (architectural intent) form a single pillar: every search, every agent turn, and every plan draws on all three at once — none is optional, none runs alone.

![Version](https://img.shields.io/badge/Version-0.4.8-gold) ![License](https://img.shields.io/badge/License-MIT-green)

## The three-tool pillar

Every answer in YodaMan blends three mandatory tools. No silos, no optional features — this is the architecture:

| Tool | Role | Powers |
|------|------|--------|
| **Context Expert** | Semantic search + LLM reasoning | Search, agent finding files, RAG retrieval |
| **Graphify** | Knowledge graph — structure | Blast radius, centrality, proximity, ranking |
| **OpenSpec** | Architecture intent — specs | Spec coverage, drift detection, propose/validate/archive workflow |

**Search** ranks by all three: semantic × 0.50 + proximity × 0.20 + centrality × 0.15 + specCoverage × 0.15. **The agent** gets a Stardust Brief every turn with graph state, spec awareness, and per-file impact. **Planning** follows Propose → Validate → Archive with drift checking.

## Why YodaMan

- **Keep code private**: Designed around local project indexing and local model workflows through Context Expert and Ollama. No code leaves your machine.
- **Understand the whole workspace**: Search and ask across indexed repositories instead of juggling isolated editor tabs.
- **See relationships, not fragments**: Graphify builds mandatory knowledge graphs that connect code, docs, diagrams, and architectural concepts.
- **Delegate carefully**: Run agent tasks with streamed progress, persisted task history, cancellation, audit logs, and approval gates for file changes.
- **Work where you already are**: Web UI, desktop app, CLI, VS Code extension, and mobile companion all talk to the same runtime.
- **Extend the assistant**: Add JavaScript plugins for custom tools. Ships with 5 plugins: CodeTrooper, Droid-Sweep, Grand Inquisitor, Lightsaber, and Graphify.
- **Drive specs with the agent**: The agent can propose, validate, and archive OpenSpec changes through `specPropose`, `specValidate`, and `specArchive` tools — following a structured Propose → Apply → Archive workflow.
- **See every tool's view of a file**: The Compose tab cross-references any file across OpenSpec (specs), Graphify (structure), and Context Expert (relevance) in three columns.
- **Understand search rankings**: The Trace tab shows why each result ranked where it did — semantic × 0.50 + proximity × 0.20 + centrality × 0.15 + specCoverage × 0.15 per result.
- **Recover gracefully**: All clients show clear recovery guidance when the local service is unavailable.

## Sub-Projects

| Project | Location | Description |
|---------|----------|-------------|
| **YodaMan Core** | `core/` | Main Express runtime, React UI, agent engine, plugins |
| **Lightsaber** | `lightsaber/` | Git health map plugin — code hotspot analysis |
| **Holocron VR** | `Holocron VR/` | 3D VR codebase explorer (community plugin) |

## Prerequisites

- Node.js 20+
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
│   ├── interfaces/             # REST controller + extracted route groups (~1626 lines)
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
│   ├── components/             # 28 UI components (Stardust, AgentChat, GraphStudio, etc.)
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

### Security settings

These live under `settings` in `config.json` and are also editable from
Settings → Developer Settings in the UI. **Every one defaults to the safe value** — you
only need to change them deliberately.

| Setting | Default | Effect when enabled |
|---------|---------|---------------------|
| `requirePairingToken` | `true` | Non-local clients must present a pairing token. Turning this off exposes the API to any device that can reach the port. |
| `allowAgentCommands` | `false` | Lets the agent run shell commands, restricted to an executable allowlist (see below). |
| `allowPluginUploads` | `false` | Accepts plugin uploads over `POST /api/plugins`. |
| `allowUnrestrictedPlugins` | `false` | Loads plugins that declare no `permissions` array. |
| `allowSelfHealInstall` | `false` | Lets `POST /api/health/install` install missing dependencies (Ollama, ctx, OpenSpec). |
| `allowedCommands` | `[]` | Extra executables the agent may run, on top of the built-in allowlist. Bare names only — `["docker", "kubectl"]`. |

Agent shell commands are restricted to an allowlist of executables (git, npm, node, python3,
and standard read-only inspection tools). Commands run without a shell, so `;`, `|`, `&`,
backticks, `$(…)`, and redirection are rejected rather than interpreted. Inline evaluation
(`node -e`, `python3 -c`) is refused; run a script file instead. Inspect the effective policy
at any time with `GET /api/policy`.

### Environment variables

Every setting above can be overridden by an environment variable, which takes precedence over
`config.json`. The name is the setting in `SCREAMING_SNAKE_CASE` with a `YODAMAN_` prefix:

| Variable | Overrides |
|----------|-----------|
| `YODAMAN_REQUIRE_PAIRING_TOKEN` | `requirePairingToken` |
| `YODAMAN_ALLOW_AGENT_COMMANDS` | `allowAgentCommands` |
| `YODAMAN_ALLOW_PLUGIN_UPLOADS` | `allowPluginUploads` |
| `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS` | `allowUnrestrictedPlugins` |
| `YODAMAN_ALLOW_SELF_HEAL_INSTALL` | `allowSelfHealInstall` |
| `YODAMAN_ALLOWED_COMMANDS` | `allowedCommands` (comma-separated) |

Runtime and paths:

| Variable | Default | Purpose |
|----------|---------|---------|
| `YODAMAN_PORT` | `3090` | HTTP/WebSocket port. |
| `YODAMAN_HOST` | `127.0.0.1` | Bind address. **Loopback by default.** Set `0.0.0.0` only to pair a phone on your LAN — the API then reaches every device on that network. |
| `YODAMAN_CONFIG_PATH` | `./config.json` | Location of the config file. |
| `YODAMAN_DB_PATH` | `./yodaman.db` | SQLite database location. |
| `YODAMAN_UPLOAD_ROOT` | OS temp dir | Where uploaded files are staged. |
| `YODAMAN_WATCH_DEBOUNCE_MS` | `1500` | File-watcher debounce before re-indexing. |

Logging:

| Variable | Default | Purpose |
|----------|---------|---------|
| `YODAMAN_LOG_DIR` | `~/.yodaman/logs` | Directory for `runtime.log`. |
| `YODAMAN_LOG_TO_FILE` | `true` | Set `false` to log to stdout only. |
| `YODAMAN_LOG_MAX_BYTES` | `5242880` | Rotate `runtime.log` at this size. |
| `YODAMAN_LOG_MAX_FILES` | `3` | Rotated files to retain. |

Agent and integrations:

| Variable | Default | Purpose |
|----------|---------|---------|
| `YODAMAN_AGENT_PROMPT_CHARS` | — | Caps the character budget for agent prompts. |
| `YODAMAN_CTX_ASK_TIMEOUT_MS` | — | Timeout for `ctx ask` calls. |
| `YODAMAN_GRAPHIFY_BIN` | `graphify` | Path to the Graphify binary. |
| `YODAMAN_GRAPHIFY_TIMEOUT_MS` | — | Graphify subprocess timeout. |
| `YODAMAN_GRAPHIFY_OLLAMA_MODEL` | — | Model Graphify uses for enrichment. |
| `YODAMAN_GRAPHIFY_FULL_EXTRACT` | — | Forces a full re-extract instead of incremental. |
| `YODAMAN_GRAPHIFY_VIZ_NODE_LIMIT` | — | Caps nodes rendered in graph visualisations. |
| `YODAMAN_GRAPHIFY_RUNNING_STALE_MS` | — | When a running Graphify job is considered stale. |

Frontend build-time variables (Vite, prefixed `VITE_`): `VITE_YODAMAN_API_BASE`,
`VITE_YODAMAN_FETCH_TIMEOUT_MS`.

## Stardust Dashboard

The **Stardust** tab is a real-time OpenSpec dashboard with 8 views:
- **Board** — live change cards with task progress, spec diff, validate/archive workflow
- **Drift** — architecture drift detection (specs vs knowledge graph)
- **Compose** — file-centric cross-reference across OpenSpec, Graphify, and Context Expert
- **Trust** — unified health dashboard with per-tool status and WorkspaceReadiness verdict
- **Trace** — search ranking transparency with per-result scoring breakdown
- **Impact** — dedicated blast-radius analysis with configurable hop depth and spec awareness
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
