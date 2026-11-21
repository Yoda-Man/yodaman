## 1. Security
- [x] 1.1 Origin and pairing gates on the `/api/stardust/live` upgrade (`tests/stardust/StardustLive.test.js`)
- [x] 1.2 Registered workspaces only for git, Stardust, ask, reindex and readiness (`tests/interfaces/GitRoutes.test.js`, `tests/interfaces/StardustRoutes.test.js`, `tests/interfaces/RestController.test.js`; guards `RegisteredWorkspacePaths`, `StardustRoutesGuarded`)
- [x] 1.3 No request text becomes a git, ctx or Graphify flag (guards `GitArgvEndsOptions`, `CtxFreeTextAfterDoubleDash`, `GraphifyArgvGuard`)
- [x] 1.4 `DELETE /api/audit` this computer only; only a real `true` approves (`RestController.test.js`, `AgentReasoningEngine.test.js`)
- [x] 1.5 Change names and `create-plugin` names stay in their folders (`StardustLive.test.js`, `CliCommands.test.js`)
- [x] 1.6 Lightsaber runs git without a shell; `api.fetch` needs `network` (`LightsaberAnalysis.test.js`, `PluginAPI.test.js`; guard `PluginsNeverUseAShell`)

## 2. Pipeline and data
- [x] 2.1 `/api/ask` through `SearchPipeline`, scoped to the workspace; `--json` before `--` (`ApiContract.test.js`, `ContextEngine.test.js`)
- [x] 2.2 Disabled-plugin list in `plugins.json` in the data folder (`ToolBox.test.js`; guard `NoStateInInstallFolder`)
- [x] 2.3 Uninstall lists every data file (`CliCommands.test.js`; guard `UninstallCoversDataFolder`)
- [x] 2.4 TaskStore prunes SQLite rows; restarted tasks are cancelled (`TaskStore.test.js`, `AgentReasoningEngine.test.js`)
- [x] 2.5 Smoke runs and render tests use temp data folders (guard `SmokeRuntimesUseTempData`)

## 3. Behaviour fixes
- [x] 3.1 REST: every error has a `code`, JSON 404 for unknown `/api`, plugin upload 409/400, delete disabled plugins, `isDefault`, missing body, settings save failure, UUID task ids, watchers without ctx (`ApiContract.test.js`, `StartupWatchers.test.js`; guard `ApiErrorsHaveCodes`)
- [x] 3.2 Git: no empty commits, long push/pull timeout, real ahead/behind, heatmap window; editors listed once (`GitRoutes.test.js`, `GitService.test.js`, `EditorLauncher.test.js`)
- [x] 3.3 Stardust: status, per-workspace validation, spec layout, watcher release, error codes; spec matching on path boundaries (`StardustLive*.test.js`, `StardustCrossTool.test.js`, `SpecDrift.test.js`)
- [x] 3.4 Graphify and health: `available`, depth, doctor freshness, `OLLAMA_HOST`, context window, "installed at", watchdog port, setup.sh versions (`GraphifyService.test.js`, `GraphifyRoutes.test.js`, `GraphifyDoctor.test.js`, `DependencyChecker.test.js`, `tests/scripts/*`; guard `OllamaAddressInOnePlace`)
- [x] 3.5 CLI, MCP, Docker, bump-version, audit-vendored, protocol header, desktop diagnostics, Droid-Sweep (`CliCommands.test.js`, `McpServer.test.js`, `AuditVendored.test.js`, `Protocol.test.js`, `StartupDiagnostics.test.js`, `Droid-Sweep.test.js`; guards `DockerfileMatchesRuntime`, `VersionReferences`)
- [x] 3.6 Web UI: chat history key, approval card, live socket, legend, Welcome text, API base, plugin delete, guide text, Stardust `projectRoot`, removed toggle (`tests/components/*`, `tests/frontend/*`; guard `ApiCallsUseApiBase`)
- [x] 3.7 Clients: mobile drift and coverage, VS Code ask, search, drift path and messages, `.d.ts`, ESLint coverage (guards `CompanionClientContracts`, `CompanionResponseFields`)

## 4. Release
- [x] 4.1 Docs and specs match the code
- [x] 4.2 Version 0.6.7 (`npm run version:check`); CHANGELOG entry
- [x] 4.3 `npm run lint` and `npx jest` pass, except `Downloads.test.js`, which needs the 0.6.7 downloads built (`npm run desktop:dist:all`, then `npm run website:downloads`)
