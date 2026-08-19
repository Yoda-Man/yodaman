# YodaMan Development Guide

This document covers the architecture, coding patterns, testing approach, and contribution workflow for developers extending or contributing to YodaMan.

## System Architecture

YodaMan follows a **Clean Architecture** pattern with three layers:

```
Frontend (React + Vite)
    ↓ HTTP / SSE
Interface Layer (REST Controller)
    ↓
Core Layer (AgentReasoningEngine, QueueService)
    ↓
Infrastructure Layer (ToolBox, ContextEngine, GraphifyService, Logger)
```

### Interface Layer — `backend/interfaces/RestController.js`

The REST controller handles all HTTP endpoints. Key route groups:

| Prefix | Purpose |
|--------|---------|
| `GET/POST /api/projects` | Workspace management |
| `POST /api/ask` | Chat questions with Graphify context |
| `POST /api/agent/task` | SSE-streamed agent tasks |
| `GET/POST/DELETE /api/plugins` | Plugin lifecycle (list, upload, delete) |
| `POST /api/plugins/:name/enable\|disable` | Plugin toggle |
| `GET /api/settings`, `PUT /api/settings` | Developer settings |
| `GET /api/git/*` | Git history, heatmap, blame, branch |
| `POST /api/reindex` | Trigger workspace reindexing |

### Core Layer — `backend/core/`

- **AgentReasoningEngine.js**: Orchestrates the autonomous agent loop. Loads tools from ToolBox, manages conversation state, streams SSE events, handles approval gates for file writes.
- **QueueService.js**: Manages background indexing jobs. Wraps Context Expert `ctx index` subprocess.

### Infrastructure Layer — `backend/infrastructure/`

| Module | Purpose |
|--------|---------|
| **ToolBox.js** | Built-in tools (readFile, writeFile, search, exec) + plugin loader + permission validation |
| **ContextEngine.js** | Wraps `ctx` CLI for search, ask, list, status |
| **GraphifyService.js** | Builds/queries knowledge graphs via `graphify` CLI |
| **Logger.js** | Structured JSON logging to memory buffer + file |
| **AuditLog.js** | Audit trail for tool calls and agent actions |
| **SessionStore.js** | Chat session persistence (SQLite or JSON) |
| **TaskStore.js** | Agent task state persistence |
| **SettingsProvider.js** | Centralized settings from config.json |
| **PluginAPI.js** | Lifecycle API for legacy plugins (onLoad/onEnable) |

## Plugin System

### Plugin Format

Plugins export an object with `name`, `description`, `permissions`, `parameters`, and `async execute()`:

```javascript
module.exports = {
  name: 'my-plugin',
  description: 'What this tool does. 💡 Chat usage: "Run my-plugin"',
  permissions: ['read'],
  parameters: {
    workspacePath: { type: 'string', required: true }
  },
  async execute(params = {}) {
    // Plugin logic here
    return { result: 'done' };
  }
};
```

### Legacy Plugin Support

Plugins using the older `onLoad`/`onEnable` lifecycle format are automatically wrapped with a compatibility layer (`PluginAPI.js`) that provides:
- `api.fetch()` — HTTP client
- `api.log.info/warn/error` — logging
- `api.ui.registerPluginCard/openModal/registerShortcut`
- `api.worker.run/terminateAll`
- `api.config.get`

### Permission Allowlist

| Permission | Description |
|------------|-------------|
| `read` | Read files and search |
| `write` | Write files |
| `command` | Execute shell commands |
| `network` | Network access |
| `search` | Semantic search |
| `unrestricted` | Full system access |

Extended permissions for legacy plugins: `graphify:read`, `agent:invoke`, `audit:write`, `webxr`, `speech`, `git:read`, etc.

### Pre-Installed Plugins

| Plugin | Description | File |
|--------|-------------|------|
| CodeTrooper | Count lines of code, files, languages | `plugins/CodeTrooper.js` |
| Droid-Sweep | Find unused files | `plugins/Droid-Sweep.js` |
| Grand Inquisitor | Scan dependencies | `plugins/Grand-Inquisitor.js` |
| Lightsaber | Git hotspot analysis | `plugins/lightsaber.js` |

Default plugins cannot be deleted or disabled through the API.

## Frontend

The React frontend lives in `src/` and is built with Vite.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| AgentChatTab | `src/components/AgentChatTab.jsx` | Chat + agent task interface |
| PluginsWindow | `src/components/PluginsWindow.jsx` | Plugin management UI |
| SettingsModal | `src/components/SettingsModal.jsx` | Workspace + developer settings |
| Dashboard | `src/components/Dashboard.jsx` | System status overview |
| GraphStudio | `src/components/GraphStudio.jsx` | Graphify visualization |

### API Client

The frontend API client is at `src/api/api.js`. It provides methods for all backend endpoints with automatic error handling and timeout management. Key methods:

```javascript
api.ask(question, projectId, mode)
api.agentTask(task, projectId, onStep, context)
api.uploadPlugin(file)
api.setMode(mode, projectId)
api.getProjects()
api.getSessions(projectId)
```

## Testing

Tests use Jest and live in `tests/`. Test suites mirror the backend structure:

```
tests/
├── core/           # AgentReasoningEngine, QueueService
├── infrastructure/ # ToolBox, Graphify, Logger, AuditLog, etc.
├── interfaces/     # RestController
├── services/       # GitService, SearchRouter, FileUpload
├── plugins/        # CodeTrooper, Droid-Sweep, lightsaber
├── components/     # AgentChatTab, PluginsWindow, GraphStudio
├── frontend/       # FileUploader, VoiceAgentBridge
├── utils/          # DocPreprocessor, QueryClassifier
└── website/        # Downloads page
```

### Running tests

```bash
npm test                    # All tests
npx jest tests/core/        # Core layer tests
npx jest tests/plugins/     # Plugin tests
```

### Writing tests

Tests should import modules directly from `backend/`:

```javascript
describe('ToolBox', () => {
  test('validates plugin permissions', () => {
    const tb = require('../../backend/infrastructure/ToolBox');
    expect(() => tb.validatePlugin({ name: 'test' })).toThrow('execute');
  });
});
```

### Release gates — testing the product, not just the code

Jest tests the code. They mock the model, ctx and Ollama, so they prove the code
would behave correctly *if* the pieces around it did. That is not the same as the
product working, and the difference is not academic: 0.4.5 shipped with the agent
unable to call a single tool while 492 tests passed, because every gate inspected
artifacts and none drove the product.

Four gates close that. They need the full local stack and are slower than the
unit suite, so they run before a release rather than on every save.

| Command | What it proves |
|---------|----------------|
| `npm run test:journeys` | Search returns the documented four-signal blend and is genuinely graph-ranked; every workspace reports state and a remediation. Fast — no agent loop. |
| `npm run test:plugins` | Every chat-invokable plugin is reachable through the agent, using the exact phrase the chat dropdown inserts. |
| `npm run test:approval` | A proposed write pauses for a decision and the file is untouched both while pending and after a rejection. This is the product's central safety claim. |
| `npm run test:packaged` | The `server.js` **inside the built `.app`** starts and answers `/api/health`. A test of the source is not a test of the artifact — 0.4.7 shipped a desktop app that could not start because `shared/` was missing from the package while every other gate passed. |

Run them all in ascending cost:

```bash
npm run release:verify   # lint, tests, both audits, release smoke, then the four gates
```

**Order matters after a version bump.** `Downloads.test.js` and
`DisplayedVersion.test.js` assert on build output, so a bump must be followed by a
build before `release:verify` is meaningful:

```bash
npm version <next> --no-git-tag-version
npm run desktop:dist:all     # regenerates dist/ and website/downloads/
npm run release:verify
```

The journey gates print `SKIP` where Ollama is unavailable, so a CI runner without
a model does not fail on an environment it cannot provide. **A skip is not a
pass** — run them where the stack is live before shipping.

### Error handling standard

`tests/infrastructure/ErrorHandling.test.js` requires every `catch` block to do
one of: log it, rethrow it, use the bound error, or carry a comment explaining
why there is nothing to handle.

The comment requirement is not box-ticking. A malformed `config.json` used to
revert every setting to its default and empty the watched directory list in
silence — a user opened YodaMan to find their projects gone with nothing anywhere
saying why. Both catches looked unremarkable. Writing the comment forces the
question "is silence actually correct here?", which is the question nobody asked.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `YODAMAN_PORT` | `3090` | Runtime port |
| `YODAMAN_REQUIRE_PAIRING_TOKEN` | `true` | Require token for remote clients |
| `YODAMAN_GRAPHIFY_BIN` | `graphify` | Graphify CLI binary |
| `YODAMAN_GRAPHIFY_TIMEOUT_MS` | `300000` | Graphify timeout |
| `YODAMAN_GRAPHIFY_FULL_EXTRACT` | `false` | Enable full semantic extraction |
| `YODAMAN_ALLOW_PLUGIN_UPLOADS` | `false` | Allow plugin .zip uploads |
| `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS` | `false` | Allow plugins with unrestricted permissions |
| `YODAMAN_ALLOW_AGENT_COMMANDS` | `false` | Allow agent to execute shell commands |

Most settings are now managed through the Settings API. Environment variables override the saved config values.

## Building for Distribution

```bash
npm run build               # Build frontend
npm run desktop:dist        # Build macOS desktop app
npm run desktop:dist:all    # Build macOS + Windows + Linux
npm run website:downloads   # Sync builds to website/downloads/
```

### VS Code Extension

```bash
cd extensions/vscode-yodaman
npm run package             # Create .vsix file
```

## Contribution Workflow

1. Fork the repository
2. Create a feature branch from `main`
3. Make changes with tests
4. Run `npm test` to verify all tests pass
5. Submit a pull request

### Code Style

- JavaScript with CommonJS modules (`require`/`module.exports`)
- 2-space indentation
- Async/await for asynchronous code
- JSDoc comments for public API methods
- Error objects with `status` and `code` properties for API handlers
