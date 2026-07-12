# Changelog - YodaMan 🚀

All notable changes to the YodaMan project are documented here.

## [0.3.7] - 2026-07-11

- Consolidated project-scoped semantic search into the Chat workspace.
- Preserved and normalized chat history across tab changes and app restarts.
- Added OpenSpec readiness and command-outcome charts plus separate change/spec listing in Stardust.
- Fixed Stardust forwarding for OpenSpec `specs` and `tools` options.

## [0.3.6] - 2026-07-05

### 🧩 UX Fixes & State Persistence
- **Tab state preserved**: All tabs now stay mounted when switching — chat, search, graph results, dashboard, stardust, and plugins no longer reset.
- **Chat history persisted**: Messages saved to localStorage for instant restore across tab switches and app restarts.
- **Search view fixed**: ExternalLink button now toggles expanded content view with full file path and line info.
- **Health dashboard**: OpenSpec now shows in system health diagnostic table.

## [0.3.4] - 2026-07-04

### 🛰️ Project Stardust — OpenSpec Integration
- **Stardust tab**: Replaced User Manual tab with Stardust — an OpenSpec CLI wrapper for structured spec-driven development.
- **OpenSpec mandatory**: `@fission-ai/openspec` is now a required dependency. Install with `npm install -g @fission-ai/openspec@latest`.
- **StardustWrapper**: Backend service that spawns `openspec` CLI as a child process with full workflow support: propose → validate → apply → archive.
- **Diagnostics panel**: Built-in OpenSpec diagnostics — version check, project status, one-click install.
- **Live output console**: Color-coded stdout/stderr capture with structured result parsing.
- **Updated documentation**: User manual, README, and website now include OpenSpec setup instructions.
- **Fresh platform builds**: macOS, Windows, and Linux desktop builds for 0.3.4.

### 🧹 Documentation Updates
- `user_manual.md` and `public/manual.html` refreshed with Stardust/OpenSpec documentation.
- Website install instructions and download links updated for 0.3.4.

## [Unreleased]

## [0.1.5] - 2026-05-14

### 💎 Professional UI & Stability Overhaul
-   **Stress-Free Engine**: Integrated automatic port conflict detection and robust CLI output parsing.
-   **Brand Identity**: Finalized **YodaMan** branding with high-fidelity glassmorphic design.
-   **Typography**: Implemented professional fonts: **Inter** (Body), **Outfit** (Headings), and **JetBrains Mono** (Technical data).
-   **High-Tech StatusBar**: Added real-time tracking for `ctx` CLI version and active AI models.
-   **Premium Chat Interface**: Completely redesigned AI chat bubbles with "analyzing" animations and a glow-focused input field.
-   **Advanced Sidebar**: Redesigned workspace manager with better hover states and active indicators.

### 🛠️ Backend & Integration
-   **Auto-Sync Engine**: Implemented automatic discovery of repositories already indexed by the `ctx` CLI.
-   **Completed Chat API**: Added the missing `/api/ask` endpoint to bridge the frontend with the AI engine.
-   **System Status API**: New `/api/status` endpoint to dynamically fetch CLI and model metadata.
-   **File Watchers**: Improved watcher logic to handle background re-indexing reliably.

### 🧹 Cleanup & Documentation
-   **Consolidated Docs**: Merged all redundant documentation into a single, comprehensive README inside the GUI directory.
-   **Corruption Fix**: Cleaned the project of multiple corrupted RTF files and verified all source code is standard plain-text.
-   **Vite Configuration**: Fixed missing Tailwind and PostCSS configurations to ensure consistent styling across all browsers.

---
*YodaMan v0.1.5 - May the Code be with you.*
