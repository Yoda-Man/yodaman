# Operational runbooks

These runbooks are for local support and handover of a YodaMan runtime.

## Start the runtime

1. Confirm Node.js 18 or newer is available.
2. Confirm `ctx --version` succeeds.
3. Confirm `graphify --help` succeeds, or set `YODAMAN_GRAPHIFY_BIN`.
4. Install dependencies with `npm install`.
5. Start YodaMan with `npm start`.
6. Open `http://localhost:5190` for the development UI or `http://localhost:3090` for packaged runtime endpoints.

## Stop the runtime

Use `Ctrl+C` in the terminal running YodaMan. The shutdown handler stops active indexing work and closes file watchers.

If a detached development process is left behind, identify it with:

```bash
lsof -i :3090
```

Then stop the matching Node process.

## Check health

Use the CLI Graphify doctor for a fast workspace graph summary:

```bash
yodaman doctor --graph
```

Use these endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | Context Expert runtime status. |
| `GET /api/check?path=/absolute/workspace` | Workspace health check through `ctx`. |
| `GET /api/desktop/diagnostics` | Process, host, memory, task, and plugin diagnostics. |
| `GET /api/graphify/status?path=/absolute/workspace` | Graphify graph artifact status. |
| `GET /api/graphify/build/status?path=/absolute/workspace` | Graphify build job and persisted build status. |
| `GET /api/policy` | Current workspace roots, blocked commands, and plugin permissions. |
| `GET /api/audit?limit=100` | Recent tool/audit activity. |

Every HTTP response includes `X-Request-Id`. Match that value with structured JSON runtime logs when investigating incidents.

## Rotate local logs

YodaMan keeps append-only local state in:

- `audit-log.jsonl`
- `task-history.jsonl`
- `audit-log.json`
- `task-history.json`
- `yodaman.db`, when SQLite is available

To archive logs, stop the runtime, move the files to a dated backup directory, then start the runtime again. Use `DELETE /api/audit` and `DELETE /api/agent/tasks` only when support intentionally wants to clear visible history.

## Recover from `ctx` CLI failures

1. Run `ctx --version`.
2. Run `GET /api/status`.
3. Confirm watched directories in `config.json` still exist.
4. Reindex a workspace with `POST /api/reindex`.
5. Restart YodaMan if `ctx` remains unresponsive.

## Recover from Graphify failures

1. Run `graphify --help`, or check `YODAMAN_GRAPHIFY_BIN`.
2. Run `yodaman doctor --graph` to summarize active graphs, freshness, orphaned nodes, and the most complex file.
3. Confirm the workspace path is registered with `GET /api/projects`.
4. Run `GET /api/graphify/status?path=/absolute/workspace`.
5. Run `POST /api/graphify/build` for the workspace.
6. Poll `GET /api/graphify/build/status?path=/absolute/workspace` until the state is `succeeded`, `partial`, or `failed`.
7. Treat `partial` as a valid large-graph outcome when `graph.json` and the report exist but `graph.html` or `graph_visualizer.html` were skipped by Graphify.
8. If orphaned nodes are reported, run Sync Repository or `POST /api/reindex` for the workspace.
9. If semantic extraction fails, confirm Ollama is running and the model named by `YODAMAN_GRAPHIFY_OLLAMA_MODEL` is available locally.

## Handle out-of-disk errors

1. Stop the runtime.
2. Check large `.yodaman-doc-chunks` directories inside watched workspaces.
3. Archive or remove old `audit-log.jsonl` and `task-history.jsonl` files.
4. Start the runtime and run a targeted reindex.

## Roll back a release

1. Stop the runtime.
2. Preserve `config.json`, `audit-log*`, `task-history*`, and `yodaman.db`.
3. Check out the previous release tag or install the previous package version.
4. Run `npm install`.
5. Restore preserved local state files.
6. Start with `npm start`.
7. Verify `/api/status`, `/api/desktop/diagnostics`, and one `/api/ask` request.
