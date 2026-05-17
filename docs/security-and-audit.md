# YodaMan Security and Audit Model

YodaMan is local-first, but local agent tools are still powerful. The runtime now includes a basic shared safety layer so the web UI, VS Code extension, desktop app, mobile client, and CLI inherit the same guardrails.

## Workspace-Scoped Tools

File and command tools are constrained to allowed roots:

- the current runtime working directory
- directories listed in `config.json` as `watchedDirectories`
- temporary test roots when running under Jest

The following tool operations validate paths before they run:

- `readFile`
- `writeFile`
- `listFiles`
- `getFileContent`
- `executeCommand` working directory
- `searchCode` project path

If a path is outside allowed roots, the runtime rejects it.

## Command Policy

`executeCommand` requires its `cwd` to be inside an allowed workspace root and blocks a small set of high-risk command patterns, including:

- recursive destructive removal against root, home, or wildcard targets
- `sudo`
- recursive ownership or permission changes
- piping remote scripts directly into `sh` or `bash`

This is not a full sandbox. It is a guardrail layer. A stronger version should use structured command execution, command allowlists, and human approval for risky commands.

## Audit Log

Tool calls made through `ToolBox.callTool` are recorded in `audit-log.json`.

The audit log captures:

- timestamp
- tool name
- status
- duration
- sanitized parameters
- result summary or error

Large file contents are summarized by character count instead of being stored verbatim.

## APIs

```http
GET /api/policy
```

Returns current policy details.

```http
GET /api/audit?limit=100
```

Returns recent audit log entries.

## Remaining Hardening Work

- Expand patch-based edits beyond the initial exact-text `applyPatch` tool.
- Enforce tool-specific approval policies for commands and plugins.
- Require plugin permission manifests instead of allowing unrestricted plugins with warnings.
- Add structured command execution instead of shell strings.
- Add authenticated pairing for mobile and remote clients.
- Move audit storage to a proper append-only store.

## Patch-Based Edits

The runtime now includes an `applyPatch(filePath, oldText, newText)` tool. It replaces exactly one occurrence of `oldText` and rejects ambiguous or missing matches. This is safer than full-file writes for small edits, although full-file `writeFile` remains available for newly generated files and broader changes.

## Plugin Permissions

Plugins may declare a `permissions` array. Plugins without permission metadata are treated as `unrestricted` and produce an audit warning when executed. A future release should require explicit permissions before loading third-party plugins.

## Mobile Pairing

The runtime exposes:

```http
POST /api/pairing
```

This returns a runtime URL, a temporary token, and a `yodaman://pair` deep link. The mobile app can use this payload to connect to the machine running YodaMan. The current token system is a pairing foundation; strict token enforcement for all remote requests should be enabled before publishing a public mobile client.

Set this environment variable before starting the runtime to require pairing tokens for non-local requests:

```bash
YODAMAN_REQUIRE_PAIRING_TOKEN=true npm run server
```

Localhost requests remain allowed so the desktop app and local web UI continue to work.
