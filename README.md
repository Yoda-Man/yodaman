# YodaMan 🚀

**YodaMan** is a premium, full-stack intelligence platform designed for developers who demand total privacy and deep semantic understanding across their entire ecosystem.

![Version](https://img.shields.io/badge/Version-0.1.6-gold)
![Architecture](https://img.shields.io/badge/Architecture-Clean-indigo)
![License](https://img.shields.io/badge/License-MIT-green)

## 🌟 Key Features

-   **Autonomous Agent Mode**: Let Yoda-Agent refactor, search, and manage your codebase with multi-step reasoning.
-   **Intelligent Indexing**: Automatically watches project directories and triggers re-indexing on file changes.
-   **Local-First Privacy**: Designed to work with local LLMs (via Ollama) to keep your intellectual property on your machine.
-   **Premium UI**: High-tech dashboard featuring glassmorphism and real-time system telemetry.

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v18+)
- [Context Expert CLI](https://github.com/Yoda-Man/context-expert) (`npm install -g @contextexpert/cli`)

### 2. Setup
```bash
git clone https://github.com/Yoda-Man/yodaman.git
cd yodaman
npm install
sh setup.sh
```

### 3. Launch
```bash
npm start
```
Visit `http://localhost:5190` to start exploring.

## 🚀 Features (v0.1.6)

- **Ecosystem-Wide Search**: Unified semantic search across all your indexed repositories.
- **Autonomous Agent (Yoda-Agent)**: A multi-step reasoning engine that can perform coding tasks.
- **Plugin Marketplace (NEW)**: Extend the agent with custom JavaScript skills via a user-friendly GUI.
- **High-Fidelity Persistence (NEW)**: Full chat history and reasoning step preservation across restarts.
- **Trust & Safety (NEW)**: Human-in-the-loop Diff Approval for all agent-initiated file modifications.
- **Professional GUI**: Modern, glassmorphic interface with real-time feedback and detailed logging.
- **Stress-Free Startup (NEW)**: Automatic port conflict resolution and robust CLI output parsing.
- **Context Expert (ctx) Integration**: Deep integration with the Context Expert CLI for semantic mapping.
- **Multi-Client Release Hygiene**: Shared versioning, package ignore rules, and publishing docs for npm, VS Code, mobile, and desktop clients.
- **Expanded Automated Tests**: Stronger coverage for exact patching, audit logs, approval rejection, malformed tool calls, and reasoning loop limits.

## Release and Publishing

The core runtime is published to npm as `yodaman`. Client packages live beside the runtime:

- `extensions/vscode-yodaman` for VS Code Marketplace packaging.
- `apps/mobile` for Expo/EAS Android and iOS builds.
- `electron/` plus `electron-builder.json` for desktop packaging.

Use `npm pack --dry-run` before publishing to verify that only runtime files are included in the npm package.

## 📚 Documentation

Detailed documentation is available in the `docs/` folder:

-   [**Architecture Overview**](docs/architecture.md): Deep dive into the Clean Architecture and component interaction.
-   [**API Reference**](docs/api.md): Full documentation for REST and SSE endpoints.
-   [**Setup & Installation**](docs/setup.md): Detailed environment configuration.
-   [**Ecosystem Architecture**](docs/ecosystem-architecture.md): VS Code, desktop, and mobile client strategy.
-   [**Security & Audit**](docs/security-and-audit.md): Workspace policy, pairing, audit logs, and tool guardrails.
-   [**Publishing**](docs/publishing.md): VS Code Marketplace and Google Play release workflow.
-   [**Publishing Todo**](docs/publishing-todo.md): Checklist for macOS, Windows, Linux, app stores, mobile stores, and VS Code Marketplace.
-   [**Website**](website/README.md): Static product website for the ecosystem.
-   [**User Manual**](user_manual.html): Visual guide for primary workflows.

## 🏗️ Clean Architecture

YodaMan is built with a layered architecture to ensure scalability:
- **Presentation**: React + Vite (Glassmorphic Design)
- **Interface**: Express Controllers (REST/SSE)
- **Core**: Business Logic (Agent Engine, Queue Management)
- **Infrastructure**: System Integrations (CLI Wrapper, File Watcher)

## 📜 License

This project is licensed under the MIT License.
