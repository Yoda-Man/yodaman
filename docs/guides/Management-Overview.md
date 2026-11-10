# YodaMan — Management Overview

## Project Scope

YodaMan is a local-first workspace intelligence platform for software developers. It runs entirely on the developer's machine — no cloud dependency, no data exfiltration. The system provides AI-powered code search, automated code analysis, autonomous agent task execution (with human approval gates), knowledge graphing via Graphify, and multi-client access (web UI, desktop app, VS Code extension, mobile companion).

## Key Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Semantic Code Search** | Natural-language search ranked by four signals: similarity, proximity, graph centrality, and spec coverage | ✅ Stable |
| **Approval Gate** | Every action that changes anything pauses for a decision, with a diff and its graph-derived blast radius | ✅ Stable (0.6.5) |
| **Agent Tasks** | Autonomous AI agent for multi-step coding work | ✅ Stable |
| **MCP Server** | Exposes search, graph, impact and spec drift to Cursor, Claude Code and Zed over stdio — read-only, no egress | ✅ Stable |
| **Graphify Knowledge Graphs** | Mandatory graph construction from project structure | ✅ Stable |
| **Plugin System** | Extend the agent with JavaScript plugins | ✅ Stable (0.6.5) |
| **Pre-Installed Plugins** | CodeTrooper, Droid-Sweep, Grand Inquisitor, Lightsaber, Holocron VR, Graphify | ✅ Stable (0.6.5) |
| **Legacy Plugin Support** | Auto-wraps onLoad/onEnable plugins | ✅ Stable (0.6.5) |
| **Zip Plugin Upload** | Upload plugins as .zip files | ✅ Stable (0.6.5) |
| **Centralized Settings** | Security switches and the editor hand-off managed from the Settings dialog; environment variables can override them | ✅ Stable (0.6.5) |
| **Desktop App** | Electron shell with managed runtime | ✅ Stable |
| **VS Code Extension** | Editor-native agent access | ✅ Stable |
| **Mobile Companion** | React Native app for monitoring and approvals | ⚠️ Beta |
| **Website + Downloads** | Public site with platform builds | ✅ Stable |

## Current Status (0.6.5)

- **Version**: 0.6.5
- **License**: MIT
- **Runtime**: Node.js 24+ / Express
- **Frontend**: React 19 + Vite + Tailwind CSS
- **AI Backend**: Ollama (qwen3.5:9b minimum; larger models supported and recommended) + local HuggingFace embeddings via Context Expert
- **Build Targets**: macOS (arm64), Windows (x64), Linux (x64)
- **Tests**: Jest suites under `tests/`, run by `npm test` and gated by `npm run release:verify`
- **6 pre-installed plugins** (graphify, Lightsaber, CodeTrooper, Droid-Sweep, Grand Inquisitor, Holocron VR)

## Project Structure

The YodaMan ecosystem includes (locations relative to the parent `yodaman/` folder):

| Component | Location | Maintainer |
|-----------|----------|------------|
| **Core Runtime** | `core/` | YodaMan Team |
| **Lightsaber Plugin** | `lightsaber/` | Community |
| **Holocron VR Plugin** | `Holocron VR/` | Community |
| **VS Code Extension** | `core/extensions/vscode-yodaman/` | YodaMan Team |
| **Mobile App** | `core/apps/mobile/` | YodaMan Team |

## Dependencies

### Runtime
- Node.js 24+, Python 3.10+
- Ollama (local LLM, the only model provider)
- Context Expert CLI (`ctx`, npm package `yodaman-ctx` 1.3.4 or later)
- Graphify (`graphify` command from the `graphifyy` Python package)
- OpenSpec CLI (`openspec`, npm package `@fission-ai/openspec`)

### NPM (8 production packages)
- Express (web server), cors
- ws (WebSocket)
- simple-git (Git operations)
- multer (file uploads)
- chokidar (file watching)
- @modelcontextprotocol/sdk and zod (MCP server)

React, Vite and Tailwind are build-time dependencies bundled into `dist/`.

### Desktop Build
- Electron 45
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
- Every agent action that changes something requires human approval
- Audit log records every tool call
- Pairing token required for non-local clients (configurable)

### Upgrades
- See `UPGRADING.md` for version-to-version notes
- Settings live in `config.json` in the user's data folder, outside the install, so upgrades keep them; environment variables override them at runtime
- Plugins without an `execute()` (onLoad/onEnable format) are auto-wrapped as legacy plugins

## Key Metrics

| Metric | Value |
|--------|-------|
| Lines of code (backend + shared) | ~14,700 |
| Lines of code (frontend, `src/`) | ~11,200 |
| Desktop download (macOS `.dmg`, arm64) | 135 MB |
| Desktop download (Windows Setup `.exe`) | 132 MB |
| Desktop download (Linux `.AppImage`) | 135 MB |

## Contact

- **Author**: Marwa Trust Mutemasango
- **Repository**: github.com/Yoda-Man/yodaman
- **npm**: `yodaman` (0.6.5)
- **License**: MIT
