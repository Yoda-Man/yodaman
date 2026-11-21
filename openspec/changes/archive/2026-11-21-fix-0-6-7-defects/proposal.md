## Why
The first OpenSpec baseline of YodaMan (17 capabilities) and a full documentation audit, both on 2026-11-21, found about fifty defects in 0.6.6: security gaps, a search path that bypassed the pipeline, data loss on upgrade, and UI and client code that read fields the runtime never sends. They shipped because no test covered them. This change fixes them for 0.6.7 and adds guard tests so each class of defect fails CI next time.

This round started before the rule that all work is driven from OpenSpec. The fixes were made first and are recorded here, with their spec deltas, so the archive keeps `openspec/specs` true.

## What Changes
- **Security:** the `/api/stardust/live` WebSocket passes the REST origin and pairing gates. Git, Stardust, ask and readiness routes accept only registered workspaces. `DELETE /api/audit` is this-computer only. Only a real `true` approves a write. Request text can no longer become git, ctx or Graphify flags. Change names, plugin names and `create-plugin` names cannot leave their folders. Lightsaber runs git with argument arrays. `PluginAPI.fetch` needs the `network` or `unrestricted` permission.
- **Pipeline:** `POST /api/ask` goes through `SearchPipeline` (ctx, Graphify ranking, OpenSpec tagging) and is scoped to the workspace.
- **Data:** the disabled-plugin list moves to `plugins.json` in the data folder, so upgrades keep it. Uninstall lists every data file. Task history is pruned in SQLite. Reloaded tasks lose their stale approvals. Smoke scripts and render tests use temp data folders.
- **Correctness:** about thirty behaviour fixes across REST errors (every error has a `code`; unknown `/api` paths give JSON 404), git (no empty commits, real ahead/behind, long push/pull timeout), Graphify (`available`, depth validation, doctor freshness), health (OLLAMA_HOST, context window, "vinstalled"), Stardust (status, per-workspace validation, spec layout, watcher release), CLI help, the Dockerfile, the version bump script, and the web UI, mobile and VS Code clients.
- **Guards:** architecture tests for git and ctx argv, Graphify argv, API error codes, registered-workspace paths, Stardust route guards, the Ollama address, API base use in the UI, client contracts and `.d.ts` coverage, shared-copy sync, state outside the install folder, smoke-test temp data, and lint coverage of every JS file.
- Version 0.6.7.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
- `agent-chat`, `agent-tools-and-approvals`, `cli-and-mcp`, `companion-clients`, `dependency-health-and-setup`, `desktop-app`, `editor-and-git`, `graphify-knowledge-graph`, `http-server-and-access`, `logs-and-audit`, `plugins`, `release-and-distribution`, `search-pipeline`, `settings-and-configuration`, `spec-workflow`, `web-ui`, `workspace-registration`.

## Impact
Backend routes and services, the agent engine and ToolBox, Stardust, Graphify and health checks, the CLI and MCP server, scripts and the release gate, bundled plugins, Electron, the React UI, the mobile app, the VS Code extension, ESLint config, docs and CHANGELOG. Client-visible API changes: new error codes, 404 for unregistered workspaces, `isDefault` on `GET /api/plugins`, `projectRoot` in `PUT /api/stardust/validation/:name`.
