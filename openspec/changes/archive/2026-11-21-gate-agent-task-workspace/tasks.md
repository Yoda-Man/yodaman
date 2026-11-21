## 1. Gate the route
- [x] 1.1 Resolve `projectId` with `resolveProjectPath` in `POST /api/agent/task` before the stream; 404 `workspace_not_registered`
- [x] 1.2 Regression test: an unregistered `projectId` gets 404 and creates no session message; a registered one still streams
- [x] 1.3 Remove the route's exception from `tests/architecture/RegisteredWorkspacePaths.test.js`

## 2. Keep the release gate honest
- [x] 2.1 `scripts/plugin-smoke.js` fails clearly when its project is not registered
- [x] 2.2 `docs/api/api.md` lists the route among those that refuse unregistered workspaces

## 3. Close
- [x] 3.1 `openspec validate --strict`, tests and lint pass
