# Changelog

All notable changes to **YodaMan** will be documented in this file.

## [0.2.1] - 2026-05-26

### Added
- Mandatory Graphify knowledge graph integration for workspace graph builds, graph-aware chat answers, and graph-aware agent context.
- Graphify plugin metadata, a required Graphify agent tool, and Graphify controls in the Plugins tab.
- Graphify REST endpoints for status, build, query, explain, and path operations.
- Default coding skill for Yoda-Agent with assumptions, simplicity, surgical edits, and verification guidance.

### Changed
- Reindexing now queues both Context Expert indexing and Graphify graph updates.
- Updated README, user manual, in-app manual, static manual, setup docs, configuration docs, runbooks, and API reference for Graphify and 0.2.1.
- Bumped the core app and VS Code extension package versions to `0.2.1`.

### Fixed
- Workspace refresh, stale workspace deletion, invalid-path reindex diagnostics, and Graphify protection from deletion.

## [0.1.9] - 2026-05-26

### Added
- Desktop runtime recovery screen with clear next steps instead of quitting when the local service cannot start.
- Runtime retry/restart flow for the desktop app while keeping the tray and menu available.
- Friendlier runtime-unavailable messages in the shared client, web chat, VS Code extension, and mobile app.

### Changed
- Desktop now opens a startup state first, attempts to start the managed runtime, then loads the app when the service is ready.
- VS Code commands now check runtime availability before ask/search/task/reindex actions and offer to start the configured runtime command.
- Mobile app now shows an inline runtime notice with pairing guidance when the configured runtime is unreachable.

### Fixed
- Shared client query-mode calls now target `/api/mode`.
- Desktop no longer exits immediately on startup service failures.

## [0.1.8] - 2026-05-26

### Added
- Query mode documentation and API reference for `code` and `doc` flows.
- Operational runbooks, configuration reference, asset license notes, CODEOWNERS, Dockerfile, and CI workflow.
- Structured request logging with request IDs and browser-visible `X-Request-Id` correlation.
- Unit and integration coverage for query classification, documentation preprocessing, search routing, and request validation.

### Changed
- Browser API client now validates non-2xx responses, parses structured error bodies, and applies configurable request timeouts.
- Runtime port and frontend API base can now be configured through environment variables.
- README now documents new capabilities, dependencies, health endpoints, and operations docs.

### Fixed
- Imported the pairing service in the REST controller so pairing-token enforcement and pairing endpoints work.
- Added validation for query mode, ask/session payloads, agent task payloads, and workspace paths.
- Added basic security headers to the Express runtime.

## [0.1.7] - 2026-05-19

### Added
- **SQLite Database Persistence**: Added Zero-Dependency local SQLite persistence (`yodaman.db`) for task history and system audit logs with automatic JSON fallback if unsupported.
- **Electron System Tray Controls**: Integrated custom System Tray menu with controls to show/hide the app, restart background daemon, copy pairing links, and quit.
- **Hierarchical Sidebar Tree View**: Redesigned VS Code extension sidebar with collapsible sections for Status & Info, Actions, and Recent Tasks.
- **API and UI Clearing Capabilities**: Added `DELETE /api/agent/tasks` and `DELETE /api/audit` API routes, client methods, and extension actions to purge history.
- **Task Detail Inspection**: Added `yodaman.viewTaskDetails` command in VS Code extension to print step-by-step logs and tool activities.
- **Integration Tests**: Added `tests/interfaces/RestController.test.js` to verify DELETE endpoint functionality, and expanded release smoke checks for Database.js integration.

## [Unreleased]

### Added
- Shared YodaMan API/SSE client, protocol constants, and TypeScript declaration files under `shared/`.
- Append-only local audit and task history logs via `audit-log.jsonl` and `task-history.jsonl`.
- Desktop native notifications for approval-needed and completed task transitions.
- Desktop folder picker for adding project workspaces.
- Mobile task event detail view.
- Release smoke check command: `npm run release:smoke`.

### Changed
- Updated roadmap, manuals, setup, API, desktop, mobile, security, publishing, and runtime protocol documentation for the new ecosystem phase.
- Mobile app now consumes the shared client through Metro workspace configuration.

## [0.1.6] - 2026-05-17

### Added
- Expanded automated coverage for patch application, audit ordering, approval rejection, malformed tool calls, and max-iteration handling.
- Release ignore rules for VS Code extension packages, mobile build output, and desktop client artifacts.

### Changed
- Bumped the core runtime, VS Code extension, and mobile app package versions to `0.1.6`.
- Refreshed website and documentation copy around the multi-client release flow and npm publish checks.

## [0.1.5] - 2026-05-14

### Added
- **Stress-Free Initialization**: Automated detection and notification for port conflicts to prevent "EADDRINUSE" crashes.
- **Robust CLI Sync**: Enhanced JSON extraction logic to handle decorative CLI banners and "dotenvx" noise, ensuring seamless project synchronization.

## [0.1.4] - 2026-05-14

### Added
- **Plugin Marketplace**: Dynamic tool extensibility with a user-friendly upload/delete GUI.
- **Session Persistence**: High-fidelity storage for chat history and agent reasoning steps.
- **Diff Approval**: Human-in-the-loop safety mechanism for autonomous file modifications.
- **Unit Tests**: Full test suite for Plugins and SessionStore infrastructure (15/15 passing).
- **Hot-Reloading**: Real-time engine updates when plugins are added or removed.

### Changed
- **Unified API**: Transitioned to query-parameter based routing for absolute project paths.
- **Manual v0.1.4**: Updated documentation to include Plugin and Safety guides.


## [0.1.3] - 2026-05-13


### Fixed
- **Robust CLI Parsing**: Improved JSON extraction logic to reliably filter out `dotenvx` banners and other CLI-injected strings during project synchronization.

## [0.1.2] - 2026-05-13

### Added
- **Auto-Discovery**: System now automatically detects and indexes projects added via  `context-expert` (ctx) CLI without requiring a restart.
- **Unified Ecosystem Logic**: Updated the core engine to support multi-project context and documentation simultaneously.
- **Premium Branding**: New Star Wars-inspired high-tech iconography (favicon and logo).
- **Expanded Documentation**: Improved README focusing on privacy and ecosystem-wide intelligence.

### Changed
- **Architecture Refactor**: Migrated from a monolithic `server.js` to a **Clean Architecture** with dedicated Services (`CliService`, `QueueService`, `WatcherService`) and API Routes.
- **Port Migration**: Moved default ports to `5190` (Frontend) and `3090` (Backend) to eliminate common development conflicts.
- **Frontend Modernization**: Centralized API interaction into a modular client and decoupled UI logic from state management.

### Fixed
- **CLI Parsing Robustness**: Implemented regex-based JSON extraction to prevent CLI header pollution from breaking the GUI.
- **Project Synchronization**: Fixed a mismatch between GUI project labels and CLI internal names.
- **Port Conflict Management**: Resolved an issue where ghost Node processes were blocking the dev server startup.

## [0.1.1] - 2026-05-12

### Added
- Initial support for `context-expert` (ctx) CLI integration.
- Glassmorphic UI design system.
- Background indexing queue.
