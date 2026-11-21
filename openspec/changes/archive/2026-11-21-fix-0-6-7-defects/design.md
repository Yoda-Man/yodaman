## Context
About fifty defects across the backend, UI, clients and release scripts, found by the first spec baseline. Eight parallel workers fixed them on disjoint files, so shared rules had to live in shared helpers, not in each fix.

## Goals / Non-Goals
**Goals:** fix every confirmed defect at its root, in shared code; pin each with a regression test that fails on 0.6.6; pin each class with a guard test.
**Non-Goals:** new features; changes to the sibling repositories (Holocron VR and lightsaber get their own OpenSpec changes); gating `/api/agent/task` by registered workspace (the plugin smoke sends an unregistered id; left for a later change).

## Decisions
- **Decision: one gate per concern, reused.** The WebSocket upgrade reuses `OriginPolicy.isLocalOrigin`, `support/http.isLocalRequest` and `PairingService.validate` (`StardustLive.allowUpgrade`), not a copy of the REST middleware. Workspace checks reuse `support/workspaces.resolveRegisteredProjectPath`. "Only from this computer" routes share `clearLocalOnly(what, code)`.
- **Decision: end options before free text.** git gets `--` or `--end-of-options`; ctx gets `--json` before `--`, then the text. Graphify reads text by position and has no `--`, so values starting with `-` are refused (names) or stripped (prose).
- **Decision: every API error is `{ error, code }`** through `jsonError`; unknown `/api` paths get JSON 404 at the end of the router, before the SPA fallback.
- **Decision: state lives in the data folder.** The disabled-plugin list moves to `dataFile('plugins.json')`, migrated once; uninstall reads `DATA_FOLDER_STATE`, so a new state file cannot be missed.
- **Decision: spec matching on path boundaries** through one helper, `SpecDrift.citesFile`, used by the agent engine and the Stardust brief.
- **Decision: a plugin's path-only fetch is a call to its own runtime** (`http://127.0.0.1:<YODAMAN_PORT>`), which is not outbound, so it needs no `network` permission; full URLs do.
- **Decision: the Ollama address comes from `OllamaConfig.ollamaUrl()`** (OLLAMA_HOST) and nowhere else.
- **Decision: record after the fact.** The fixes predate the rule that work starts as an OpenSpec change, so the spec deltas copy the post-fix requirements from `openspec/specs` (MODIFIED, identical content). Archiving changes no spec text; it records which requirements this release changed.

## Risks / Trade-offs
- Clients that send an unregistered folder now get 404 → the VS Code extension and mobile app explain "Add this folder to YodaMan first".
- `isDefault`, new error codes and `projectRoot` on the validation PUT change the API surface → documented in `docs/api/api.md` and the 0.6.7 CHANGELOG.
- A path-only plugin fetch assumes the runtime listens on loopback; with `YODAMAN_HOST` set to one LAN address it will not connect.
