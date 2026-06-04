# Support Handover

## Ownership

| Area | Support owns | Engineering owns |
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

Escalate to engineering when:

- A secure default must be disabled for normal use.
- Graphify or Context Expert binaries are available but runtime startup still fails.
- A graph build remains `running` or `failed` after restart and rebuild.
- Package dry-run includes local state or developer-specific paths.
- Audit reports a high or critical vulnerability.
- Agent approval, cancellation, or audit logs are inconsistent after restart.
