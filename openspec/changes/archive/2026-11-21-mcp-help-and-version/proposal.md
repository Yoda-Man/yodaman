## Why
`yodaman-mcp --help` starts the stdio MCP server and waits for a client, so a user who asks what the command does sees a hung terminal. `yodaman --help` was fixed in 0.6.7; the second executable was missed.

## What Changes
- `yodaman-mcp --help` (or `-h`) prints usage, the five tools, the runtime URL it proxies and the `YODAMAN_PORT`/`YODAMAN_URL` overrides, then exits 0.
- `yodaman-mcp --version` (or `-v`) prints the version and exits 0.
- Any other argument starts the server as before.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
- `cli-and-mcp`: the MCP server's command line.

## Impact
`bin/yodaman-mcp.mjs`, `tests/interfaces/McpServer.test.js`, `docs/guides/mcp.md`.
