# MCP — lending your codebase to other agents

Cursor, Claude Code and Zed have strong models and no idea what is in your
private codebase. YodaMan has a local index of exactly that. The MCP server
offers it to them over stdio, without the code leaving your machine.

## What it exposes

Five tools, all read-only:

| Tool | What it answers |
| --- | --- |
| `yodaman_projects` | Which workspaces are indexed, and how fresh each is. Call this first — everything else needs an absolute workspace path. |
| `yodaman_search` | Semantic search ranked by four signals: similarity, proximity to the file you are in, centrality in the dependency graph, and spec coverage. |
| `yodaman_graph_query` | Relationships between code, docs and diagrams from the Graphify knowledge graph. |
| `yodaman_impact` | What depends on a file or symbol, how far the effect reaches, which tests cover it. |
| `yodaman_spec_drift` | Where OpenSpec intent and the code disagree — specs citing files that no longer exist, and load-bearing modules no spec describes. |

`yodaman_spec_drift` is the one worth reaching for first. It is the thing a
model reading your repository cannot work out on its own, because it needs the
specs and the graph together.

## Setting it up

The server ships with the package, so no separate install:

```bash
npm install -g yodaman
```

MCP is a protocol, so **any client that speaks it works**. The only thing that
differs is where the configuration lives. `yodaman-mcp` ships with the package,
so there is nothing extra to install.

### Claude Code

```bash
claude mcp add yodaman -- yodaman-mcp
```

### Cursor — `~/.cursor/mcp.json` (or `.cursor/mcp.json` per project)

```json
{
  "mcpServers": {
    "yodaman": { "command": "yodaman-mcp" }
  }
}
```

### Zed — `settings.json`

```json
{
  "context_servers": {
    "yodaman": { "command": { "path": "yodaman-mcp", "args": [] } }
  }
}
```

### VS Code (GitHub Copilot) — `.vscode/mcp.json`

```json
{
  "servers": {
    "yodaman": { "type": "stdio", "command": "yodaman-mcp" }
  }
}
```

### Windsurf, Cline, Continue, and most other clients

```json
{
  "mcpServers": {
    "yodaman": { "command": "yodaman-mcp" }
  }
}
```

### Anything else

If a client accepts a stdio MCP server, point it at the `yodaman-mcp`
executable with no arguments. If `yodaman-mcp` is not on the client's `PATH` —
which happens when the client launches outside your shell — give the absolute
path instead:

```bash
which yodaman-mcp    # use this path in the client's config
```

The same panel is in the app: **Settings → Connect other agents**, with a copy
button per client.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `YODAMAN_URL` | `http://127.0.0.1:3090` | Where the runtime is listening. |
| `YODAMAN_PORT` | `3090` | Used when `YODAMAN_URL` is unset. |
| `YODAMAN_MCP_TIMEOUT` | `120000` | Milliseconds before a request gives up. Semantic search on a very large workspace can take tens of seconds. |

## Two decisions worth knowing about

**Every tool is read-only, permanently.** YodaMan's approval gate protects
writes made by YodaMan's own agent — it pauses each one for a diff and a
graph-derived blast radius. A client on the far side of this boundary does not
run that gate and cannot be made to. Offering a write tool here would hand out a
key to a door we deliberately lock, so `tests/interfaces/McpServer.test.js`
fails if a tool with a mutating name ever appears, if the server ever issues a
`PUT`, `PATCH` or `DELETE`, or if it ever imports a write path directly.

If you want an agent to change files through YodaMan, use YodaMan's own agent,
where the approval gate applies. See [Approvals](approvals.md).

**It proxies the runtime rather than re-implementing it.** Search ranking blends
four signals and lives behind an HTTP route. A second implementation inside the
MCP server would drift from the first — which is exactly the failure that cost a
file-descriptor leak when one ignore list quietly became four. The MCP results
are verified to match the HTTP API: same count, same ordering, same weights.

## Privacy

stdio only. Nothing listens on a port, nothing is sent anywhere, and there are
no API keys or accounts. The server talks to `127.0.0.1` and nowhere else. The
client you connect may have its own data policies — that is between you and it —
but YodaMan adds no egress of its own.

## Checking it works

```bash
npx @modelcontextprotocol/inspector yodaman-mcp
```

Five tools should list. Call `yodaman_projects` first; if it reports the runtime
is unreachable, start YodaMan and try again.
