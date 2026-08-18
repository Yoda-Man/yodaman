# Changelog

## 0.4.5 - 2026-08-18

### Added — the rest of the runtime

The extension reached the agent but not the three-tool pillar behind it. Seven
commands close that gap, and they lean on what only an editor can do.

- **Blast Radius For This File** — dependents, centrality, spec coverage and
  whether any test covers the file you are looking at. On the editor and
  explorer context menus, because the question is asked about a specific file.
  Warns rather than informs when a file has dependents and no covering test.
- **Check Spec Drift** — publishes drift into the **Problems panel** as real
  diagnostics instead of printing it to a log. A stale reference lands on the
  spec that cites a missing file; an undocumented load-bearing module lands on
  that module. Clear them with **Clear Spec Drift Markers**.
- **Stardust Change Board** — active OpenSpec changes, with graph freshness.
- **Runtime Diagnostics** — all three pillar tools plus Ollama, workspace
  readiness per project, and the remediation each stale workspace needs.
- **Pending Approvals** — reach the approval gate without a live task.
- **List Plugins** — what the runtime loaded, and whether it is enabled.

A "Pillar & Stardust" section in the sidebar makes these clickable.

### Changed — search results open the file

Search printed raw JSON to the output channel. It now offers a pick list that
opens the file, carrying the blended score and OpenSpec coverage so the ranking
stays inspectable. The raw payload still goes to the channel.

### Removed — the Code/Documentation mode prompt

Asking a question popped a "select query mode" pick list on every single
question. The choice was stored, logged, and never sent: `client.ask()` posts
only the question and project. The runtime dropped that mode in 0.4.1, so the
prompt had been asking users to choose between two identical outcomes ever
since. Gone, along with the `switchMode` command (registered but never declared,
so it was unreachable anyway) and an empty `if (mode) {}` block in the agent
task path.

### Fixed — upstream

The runtime fixes in `0.4.5` matter here too: a workspace scan could wedge the
runtime at 100% CPU, which left every request from this extension hanging. See
the core changelog.

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
