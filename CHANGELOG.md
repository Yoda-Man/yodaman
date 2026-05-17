# Changelog

All notable changes to **YodaMan** will be documented in this file.

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
