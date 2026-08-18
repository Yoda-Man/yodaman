# Changelog

## 0.4.5 - 2026-08-18

- Align extension package version with the YodaMan `0.4.5` release.
- No extension code changed in this release. The fixes in `0.4.5` are in the runtime the
  extension talks to — most importantly a workspace scan that could wedge the runtime at
  100% CPU, leaving every request from this extension to hang. See the core changelog.

_Entries for 0.4.1 through 0.4.4 were never recorded here; the core `CHANGELOG.md` covers
those releases._

## 0.4.0 - 2026-08-04

- Synchronized with core v0.4.0

## 0.4.0 - 2026-08-03

- Synchronized with core v0.4.0

## 0.3.8

- Align extension package version with the YodaMan `0.3.8` release.
- Runtime health checks now include OpenSpec, so an offline or missing OpenSpec install is reported alongside Ollama, `ctx`, and Graphify.

## 0.2.2

- Align extension package version with the YodaMan `0.2.2` release.
- Document the refreshed workspace management, runtime recovery, and client manual flows.
- Add workspace registration commands with folder browsing, path paste, and current-workspace options.
- Add runtime log viewing for request, index queue, and ctx indexing output.

## 0.1.9

- Align extension package version with the YodaMan `0.1.9` hardening release.
- Add runtime availability checks before workspace actions.
- Offer to start the configured runtime command when YodaMan is offline.
- Improve offline error messages for ask, search, agent task, reindex, and history actions.

## 0.1.7

- Add TreeView-based sidebar hierarchy (Status & Info, Actions, Recent Tasks).
- Add task detail inspection view (view task details command).
- Add support for clearing task history and clearing audit logs directly from sidebar commands.

## 0.1.6

- Align extension package version with the YodaMan `0.1.6` ecosystem release.
- Document local VSIX package output as an ignored build artifact.

## 0.1.0

- Initial YodaMan VS Code extension MVP.
- Added runtime status checks, runtime start command, workspace ask/search/reindex commands, streamed agent task execution, task cancellation, Activity Bar sidebar, and diff approval for proposed writes.
