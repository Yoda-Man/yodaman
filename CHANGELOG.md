# Changelog

All notable changes to **YodaMan** will be documented in this file.

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
