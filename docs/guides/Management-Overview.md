# YodaMan — Management Overview

## Project Scope

YodaMan is a local-first workspace intelligence platform for software developers. It runs entirely on the developer's machine — no cloud dependency, no data exfiltration. The system provides AI-powered code search, automated code analysis, autonomous agent task execution (with human approval gates), knowledge graphing via Graphify, and multi-client access (web UI, desktop app, VS Code extension, mobile companion).

## Key Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Semantic Code Search** | Natural-language search ranked by four signals: similarity, proximity, graph centrality, and spec coverage | ✅ Stable |
| **Approval Gate** | Every action that changes anything pauses for a decision, with a diff and its graph-derived blast radius | ✅ Stable (0.5.3) |
| **Agent Tasks** | Autonomous AI agent for multi-step coding work | ✅ Stable |
| **MCP Server** | Exposes search, graph, impact and spec drift to Cursor, Claude Code and Zed over stdio — read-only, no egress | ✅ Stable |
| **Graphify Knowledge Graphs** | Mandatory graph construction from project structure | ✅ Stable |
| **Plugin System** | Extend the agent with JavaScript plugins | ✅ Stable (0.5.3) |
| **Pre-Installed Plugins** | CodeTrooper, Droid-Sweep, Grand Inquisitor, Lightsaber, Holocron VR, Graphify | ✅ Stable (0.5.3) |
| **Legacy Plugin Support** | Auto-wraps onLoad/onEnable plugins | ✅ Stable (0.5.3) |
| **Zip Plugin Upload** | Upload plugins as .zip files | ✅ Stable (0.5.3) |
| **Centralized Settings** | All developer settings managed from UI | ✅ Stable (0.5.3) |
| **Desktop App** | Electron shell with managed runtime | ✅ Stable |
| **VS Code Extension** | Editor-native agent access | ✅ Stable |
| **Mobile Companion** | React Native app for monitoring and approvals | ⚠️ Beta |
| **Website + Downloads** | Public site with platform builds | ✅ Stable |

## Current Status (0.5.3)

- **Version**: 0.5.3
- **License**: MIT
- **Runtime**: Node.js 18+ / Express
- **Frontend**: React 18 + Vite + Tailwind CSS
- **AI Backend**: Ollama (qwen3.5:9b minimum; larger models supported and recommended) + HuggingFace embeddings
- **Build Targets**: macOS (arm64), Windows (x64), Linux (x64)
- **Test Coverage**: 30+ test suites, ~106 passing tests
- **5 pre-installed plugins** (graphify, Lightsaber, CodeTrooper, Droid-Sweep, Grand Inquisitor)

## Project Structure

The YodaMan ecosystem includes:

| Component | Location | Maintainer |
|-----------|----------|------------|
| **Core Runtime** | `core/` | YodaMan Team |
| **Lightsaber Plugin** | `lightsaber/` | Community |
| **Holocron VR Plugin** | `Holocron VR/` | Community |
| **VS Code Extension** | `extensions/vscode-yodaman/` | YodaMan Team |
| **Mobile App** | `apps/mobile/` | YodaMan Team |

## Dependencies

### Runtime
- Node.js 18+, Python 3.10+
- Ollama (local LLM)
- Context Expert CLI (`ctx`)
- Graphify (`graphify` Python package)

### NPM (9 production packages)
- Express (web server)
- React 18 (UI framework)
- Vite (build tool)
- simple-git (Git operations)
- multer (file uploads)
- chokidar (file watching)

### Desktop Build
- Electron 42
- electron-builder

## Maintenance Requirements

### Regular Tasks
- Keep Ollama model updated (`ollama pull qwen3.5:9b`)
- Monitor `ctx` compatibility with latest Node.js
- Update Graphify for new language support
- Review plugin permission allowlist for new use cases

### Security Considerations
- All data stays local — no cloud dependencies
- Plugin permissions are validated against an allowlist
- Agent file writes require human approval
- Audit log tracks all tool calls
- Pairing token required for non-local clients (configurable)

### Upgrade Path (0.2.2 → 0.4.8)
- Backward compatible — no breaking API changes
- Plugins from 0.2.2 continue to work; plugin.json `minYodaManVersion` must be ≤ 0.4.8
- Legacy plugins (onLoad format) now auto-detected
- Settings migrate automatically from env vars to config.json

## Key Metrics

| Metric | Value |
|--------|-------|
| Lines of code (backend) | ~15,000 |
| Lines of code (frontend) | ~8,000 |
| Test suites | 30+ |
| Published versions on npm | 13 |
| Desktop build size (macOS) | 124 MB |
| Desktop build size (Windows) | 107 MB |
| Desktop build size (Linux) | 125 MB |

## Contact

- **Author**: Marwa Trust Mutemasango
- **Repository**: github.com/Yoda-Man/yodaman
- **npm**: `yodaman` (0.5.3)
- **License**: MIT
