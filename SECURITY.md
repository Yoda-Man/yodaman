# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Email **trustaldo@gmail.com** with `SECURITY` in the subject line.

This is the reporting channel for both YodaMan and Holocron VR.

Please include the version (`npm list -g yodaman`, or the version shown in the
app), your OS, how you installed it, and the smallest set of steps that
reproduces the issue.

## What to expect

This project is maintained by one person, so these are honest targets rather
than a commercial SLA:

| Stage | Target |
| --- | --- |
| Acknowledgement | 3 working days |
| Initial assessment | 10 working days |
| Fix or documented mitigation for confirmed high-severity issues | 30 days |

You will be credited in the advisory and release notes unless you ask not to be.
Please give us the 30-day window before disclosing publicly; if we go quiet past
these targets, disclose — an unresponsive maintainer is not a reason to leave
users exposed.

## Supported versions

The latest minor release only. There are no long-term support branches.

## Scope

Reports against these are in scope:

- **The local runtime**, which listens on `127.0.0.1:3090` by default
  (`YODAMAN_HOST`, `YODAMAN_PORT`) — request handling, the pairing-token gate,
  path traversal, or anything that reads or writes outside a watched workspace.
- **The MCP server** (`bin/yodaman-mcp.mjs`) — in particular any way to make it
  perform a write, since it is read-only by design and enforced by tests.
- **The approval gate** (`shared/toolCapabilities.js`,
  `backend/core/AgentReasoningEngine.js`) — any path by which the agent modifies
  a file without the change being presented for approval first. This is the
  product's central safety claim; treat a bypass as high severity.
- **MCP client visibility** (`backend/infrastructure/McpClients.js`) — it must
  never record queries, tool arguments, or file paths.
- **The Ollama context-length setting**, which writes a launchd plist and
  restarts a service. Anything that lets an unvalidated value reach that file.
- **Any unexpected network egress.** YodaMan is local-first; traffic to anywhere
  other than the local runtime and your configured local model is a bug. Two
  exceptions are expected: a package install you start yourself, through
  `yodaman setup` or the Dashboard's Repair (off unless you enable it in
  Settings), which reaches the npm and pip registries; and Context Expert's
  one-time download of its embedding model weights from Hugging Face, which
  sends no code or queries.

## Not vulnerabilities

To save you the effort, these are known and intentional:

- **The runtime opens a local port.** It binds loopback (`127.0.0.1`) and is not
  reachable from the network unless you set `YODAMAN_HOST` (for example
  `0.0.0.0` for the mobile companion). Then any request not from the machine
  itself needs a pairing token, which `requirePairingToken` enforces by default.
  Tokens are created, and settings changed, only from the machine itself; a
  device that can create its own token, or change a setting with one, is in
  scope.
- **Any local process can reach the runtime.** There is no authentication on
  loopback; only requests from web pages on non-local origins are refused.
  YodaMan's trust boundary is the machine; a hostile process already running as
  your user has better options than the YodaMan API. If you need a stronger
  boundary, do not run untrusted code as your own user.
- **The MCP client header is self-reported.** `X-YodaMan-MCP-Client` carries
  whatever a client claims to be, so the Settings list is an honest record of
  what was claimed, not an authenticated identity. It is bounded and sanitised
  (length-capped, control characters stripped) precisely because it is untrusted.
- **Reports produced only by an automated scanner**, with no demonstrated impact
  on the above. Please show what an attacker actually achieves.
