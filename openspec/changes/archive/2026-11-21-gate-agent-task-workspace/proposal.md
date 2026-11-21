## Why
0.6.7 limited every route that touches a workspace to registered workspaces, except `POST /api/agent/task`, which still runs the agent against any folder a client names. The agent's tools then read, search and (after approval) write inside that folder. It was left open only because the plugin smoke test sent a folder that might not be registered.

## What Changes
- `POST /api/agent/task` resolves `projectId` through the registered-workspace helper before the stream starts. An unregistered workspace gets `404 { error, code: "workspace_not_registered" }` and no task is created.
- `scripts/plugin-smoke.js` checks that its project is a registered workspace and fails with a clear message when it is not, instead of reading a 404 as a plugin failure.
- The `RegisteredWorkspacePaths` guard loses its exception for this route.
- The agent-chat spec drops the stale `Math.random()` task id (ids are `crypto.randomUUID()` since 0.6.7).

## Capabilities
### New Capabilities
None.
### Modified Capabilities
- `agent-chat`: Start an agent task.

## Impact
`backend/interfaces/RestController.js`, `scripts/plugin-smoke.js`, `tests/architecture/RegisteredWorkspacePaths.test.js`, tests, `docs/api/api.md`. Clients already handle `workspace_not_registered` (web UI, VS Code, mobile).
