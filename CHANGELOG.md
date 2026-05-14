# Changelog

All notable changes to **YodaMan** will be documented in this file.

## [0.1.4] - 2026-05-14

### Added
- **Autonomous Agent Mode**: Integrated a reasoning loop (ReAct) allowing the AI to use tools (read/write/shell).
- **Real-time Monitoring**: Added SSE streaming for agent tasks with a live step monitor in the UI.
- **Detailed Documentation**: Created a comprehensive `docs/` folder with architecture diagrams and API references.

### Changed
- **Major Architecture Refactor**: Transitioned to a formal **Clean Architecture** (Infrastructure, Core, Interface layers).
- **Service Overhaul**: Refactored all backend services for better maintainability and logging.
- **UI Refresh**: Updated the chat interface with Agent Mode controls and improved typography.

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
