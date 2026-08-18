# Operational runbooks

These runbooks are for local support and handover of a YodaMan runtime.

See the [Support Handover](#support-handover) section below for ownership, severity, escalation, and
pre-handover verification. (It used to live in a separate `docs/support-handover.md`; that file was merged
into this one.)

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

Use the CLI dependency doctor to verify every required dependency is installed and reachable:

```bash
yodaman doctor
```

Add `--json` for machine-readable output. The command exits non-zero when degraded.

Use the CLI Graphify doctor for a fast workspace graph summary:

```bash
yodaman doctor --graph
```

Use these endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Full health check: Ollama, ctx, Graphify, OpenSpec reachability + version. Returns `degraded`/`pending` arrays naming missing checks. |
| `GET /api/readiness` | Workspace readiness verdict (ready/stale/building/unindexed) across all watched directories. |
| `GET /api/status` | Context Expert runtime status. |
| `GET /api/check?path=/absolute/workspace` | Workspace health check through `ctx`. |
| `GET /api/desktop/diagnostics` | Process, host, memory, task, and plugin diagnostics. |
| `GET /api/graphify/status?path=/absolute/workspace` | Graphify graph artifact status. |
| `GET /api/graphify/build/status?path=/absolute/workspace` | Graphify build job and persisted build status. |
| `GET /api/policy` | Current workspace roots, blocked commands, and plugin permissions. |
| `GET /api/audit?limit=100` | Recent tool/audit activity. |

Every HTTP response includes `X-Request-Id`. Match that value with structured JSON runtime logs when investigating incidents.

## Search Runtime Logs

**The log file is `~/.yodaman/logs/runtime.log`** (override with `YODAMAN_LOG_DIR`). One JSON object per
line. Before August 2026 the runtime logged to stdout only, which meant the packaged desktop app produced no
log artefact at all — if you are supporting a build older than that, the file will not exist and you must
fall back to the in-app Logs modal.

**Ask the user for this file first.** It survives restarts; the in-memory buffer behind the Logs modal keeps
only the last 500 entries.

```bash
# errors only
grep '"level":"error"' ~/.yodaman/logs/runtime.log | tail -50

# follow one request end to end (X-Request-Id is on every HTTP response)
grep '<request-id>' ~/.yodaman/logs/runtime.log

# rejected cross-site calls — a client pointed at the wrong origin
grep 'cross_site_blocked' ~/.yodaman/logs/runtime.log

# runtime bound to the network rather than loopback
grep 'runtime_bound_non_loopback' ~/.yodaman/logs/runtime.log

# pretty-print with jq
tail -100 ~/.yodaman/logs/runtime.log | jq 'select(.level=="error")'
```

The in-app Logs modal remains good for first response — text search plus level, severity, and user-action
filters. For API-level diagnostics:

```bash
curl "http://localhost:3090/api/logs?level=error&userAction=code_search&query=ctx"
curl "http://localhost:3090/api/logs?level=error&userAction=agent_tool_call"
curl "http://localhost:3090/api/logs?severity=critical"
```

Search, chat, agent tool, startup, unhandled HTTP, unhandled rejection, and uncaught exception failures should appear here with stack traces and request or task context.

## Rotate local logs

`runtime.log` **rotates itself**: at 5 MB it becomes `runtime.log.1`, and three files are retained. Tune with
`YODAMAN_LOG_MAX_BYTES` and `YODAMAN_LOG_MAX_FILES`; set `YODAMAN_LOG_TO_FILE=false` to disable file logging.
No manual rotation is needed, and no cron job should be added.

If the log directory cannot be written, the runtime logs `log_file_sink_disabled` once to stdout and carries
on — file logging failing never takes the runtime down. Seeing that message means the directory is
unwritable, not that the runtime is unhealthy.

YodaMan also keeps append-only local state, which does **not** self-rotate:

- `audit-log.jsonl`
- `task-history.jsonl`
- `audit-log.json`
- `task-history.json`
- `yodaman.db`, when SQLite is available

To archive those, stop the runtime, move the files to a dated backup directory, then start the runtime again. Use `DELETE /api/audit` and `DELETE /api/agent/tasks` only when support intentionally wants to clear visible history.

## Runtime is listening but answers nothing (100% CPU)

The hardest failure to recognise, because every ordinary check looks healthy: the
port is bound, the process is alive, and the startup log ends with
`startup_health_summary healthy: true`. What gives it away is that requests hang
rather than fail — `curl` times out instead of being refused — while the process
sits near 100% CPU.

This happens when a synchronous scan blocks the event loop. One instance ran for
17 hours undetected in August 2026 (a symlink cycle in a watched Flutter project;
fixed in 0.4.6). Assume any future variant has the same signature.

1. Confirm the shape rather than guessing:
   ```bash
   lsof -nP -iTCP:3090 -sTCP:LISTEN     # bound?
   ps -o pid,stat,%cpu,etime -p <PID>   # near 100% CPU, long ELAPSED?
   curl -m 5 http://127.0.0.1:3090/api/health   # hangs, rather than refusing?
   ```
   All three together mean a blocked event loop. Any one alone does not.
2. Capture evidence before killing it — the process is the only record of the
   cause, and a restart destroys it:
   ```bash
   sample <PID> 5 -f /tmp/yodaman-wedge.txt    # macOS
   ```
   A stack dominated by `scandir` / `opendir` / `readdir` means a runaway
   filesystem walk. Attach this to the escalation.
3. **`SIGTERM` will not work.** The handler needs the same blocked event loop.
   Use `kill -9 <PID>`. If a plain `kill` appears to do nothing, this is why —
   it is not a permissions problem.
4. Restart, then confirm recovery with `curl -m 5 .../api/readiness`. A healthy
   runtime answers in well under a second.
5. If it wedges again, identify the workspace: remove watched directories from
   `config.json` one at a time, restarting between each. Projects containing
   symlink farms (Flutter `.plugin_symlinks/`, `node_modules/.bin`, pub caches)
   are the first to suspect. Escalate with the sample from step 2.

**Detection is manual.** There is no alerting; nothing will page anyone when this
happens. Until that changes, a periodic `curl -m 5 .../api/health` from outside
the runtime is the only early warning available.

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
# Support Handover

## Ownership

> **"Engineering" is one person.** YodaMan has a single maintainer: **Marwa Trust Mutemasango**
> (GitHub [@Yoda-Man](https://github.com/Yoda-Man), trustaldo@gmail.com), author of all 110 commits and the
> only npm publisher. There is no rota, no secondary on-call, and no second person who can cut a release.
>
> Support must plan around this rather than discover it during an incident:
>
> - **Every escalation below goes to one inbox.** Assume no response outside that person's working hours.
> - **Anything requiring a release is blocked on their availability** — npm publish, desktop signing, and
>   notarization credentials are not shared.
> - **Widen the "Support owns" column wherever possible.** Each item support can resolve unaided is one that
>   does not queue behind a single individual. The runbook sections below are written to that end.
> - `CODEOWNERS` documents ownership but cannot enforce review: GitHub never requests a review from the
>   author of a pull request, so with one maintainer there is no second pair of eyes on any change.
>
> **This is the single largest handover risk and it cannot be closed by code.** Closing it means adding a
> second maintainer with publish rights. Until then, treat the bus factor as an accepted, documented risk
> with a named owner — not as something the support team can mitigate.

| Area | Support owns | Engineering owns (@Yoda-Man) |
| --- | --- | --- |
| Runtime startup | Node, `ctx`, Graphify, Ollama availability checks; local config validation; restart guidance. | Runtime crashes, dependency incompatibilities, API regressions. |
| Workspace indexing | Sync Repository, `/api/reindex`, queue inspection, stale or missing local paths. | Index queue bugs, unsafe file watcher behavior, Context Expert protocol changes. |
| Graphify | `yodaman doctor --graph`, artifact status, large-graph partial outcomes, rebuild requests. | Graph extraction failures, artifact generation regressions, Graph Studio rendering bugs. |
| Security toggles | Confirm secure defaults remain enabled. Temporarily enable risky toggles only for trusted local support sessions. | Permission model changes, plugin sandboxing, agent command policy. |
| Releases | Run test, build, release smoke, audit, and package dry-run before handover. | Failed release checks, signing/notarization, Marketplace or package publication failures. |

## Severity Model

| Severity | Definition | Examples |
| --- | --- | --- |
| Critical | Data exposure, arbitrary remote execution, or runtime unusable for all users. | Remote requests accepted without tokens, plugin code execution from untrusted upload, runtime cannot start. |
| High | Handover blocker or single workflow unusable with no clear workaround. | Graphify unavailable, package cannot be produced, agent approval flow broken. |
| Medium | Support can work around it, but user impact or operational cost is meaningful. | Slow graph status on large repos, stale graph artifacts, noisy reindex queue. |
| Low | Documentation, polish, or maintainability issue that does not block support. | Missing screenshots, verbose logs, route-module organization debt. |

## Secure Defaults

These defaults are intentional for handover:

- Non-local requests require `X-YodaMan-Token` unless `YODAMAN_REQUIRE_PAIRING_TOKEN=false`.
- Plugin uploads are disabled unless `YODAMAN_ALLOW_PLUGIN_UPLOADS=true`.
- Agent shell commands are disabled unless `YODAMAN_ALLOW_AGENT_COMMANDS=true`.
- Unrestricted plugins are disabled unless `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true`.

Enable risky toggles only in trusted local support sessions, then restart the runtime without them when support work is complete.

## Pre-Handover Verification

Run from the repository root:

```bash
npm audit
npm test
npm run build
npm run release:smoke
npm --cache /private/tmp/yodaman-npm-cache pack --dry-run
yodaman doctor --graph
```

Expected results:

- `npm audit` reports `found 0 vulnerabilities`.
- Tests and build pass.
- Release smoke checks pass.
- Package dry-run lists `config.example.json`, not a developer-specific `config.json`.
- Graph doctor reports active projects and any orphaned-node warnings.

## Known Recovery Paths

| Symptom | First check | Recovery |
| --- | --- | --- |
| Runtime unreachable | `GET /api/desktop/diagnostics` or desktop recovery screen. | Restart managed runtime or run `npm start`. |
| Non-local client receives 401 | Pairing token missing or expired. | Create a new pairing link with `POST /api/pairing`. |
| Workspace missing | `GET /api/projects` and local `config.json`. | Re-add the workspace from Settings. |
| Search stale or failing | Logs modal or `/api/logs?userAction=code_search`. | Check query errors and queue state, then run Sync Repository or `POST /api/reindex`. |
| Graph visualization unavailable | `GET /api/graphify/status?path=...`. | Use Map Preview/Report, then rebuild graph. Large graphs can be `partial`. |
| Orphaned graph nodes | `yodaman doctor --graph`. | Run Sync Repository or `POST /api/reindex` for the affected workspace. |
| Plugin upload fails | Secure default is disabled. | Enable `YODAMAN_ALLOW_PLUGIN_UPLOADS=true` only for trusted local upload, then restart securely. |
| Agent command fails | Secure default is disabled. | Prefer file/search/Graphify tools. Enable `YODAMAN_ALLOW_AGENT_COMMANDS=true` only for trusted local support sessions. |

## Diagnostic Log Queries

- `GET /api/logs?level=error&userAction=code_search`: Search failures with query and workspace context.
- `GET /api/logs?level=error&userAction=agent_tool_call`: Agent tool failures with task id, tool name, and project path.
- `GET /api/logs?level=error&userAction=chat_ask`: Chat and Graphify-augmented ask failures.
- `GET /api/logs?severity=critical`: Unhandled HTTP/runtime errors.

## Escalation Triggers

**Escalate to:** Marwa Trust Mutemasango — GitHub [@Yoda-Man](https://github.com/Yoda-Man),
trustaldo@gmail.com. Single maintainer; there is no secondary contact. For anything security-related, open a
private advisory on the repository rather than a public issue.

Escalate when:

- A secure default must be disabled for normal use.
- Graphify or Context Expert binaries are available but runtime startup still fails.
- A graph build remains `running` or `failed` after restart and rebuild.
- Package dry-run includes local state or developer-specific paths.
- Audit reports a high or critical vulnerability.
- Agent approval, cancellation, or audit logs are inconsistent after restart.
