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

### Claude Code

```bash
claude mcp add yodaman -- yodaman-mcp
```

### Cursor, Zed, and other clients

Add to the client's MCP configuration:

```json
{
  "mcpServers": {
    "yodaman": {
      "command": "yodaman-mcp"
    }
  }
}
```

**YodaMan itself must be running** — open the desktop app, or start the runtime.
The MCP server is a thin proxy; if the runtime is not up it says so and names
the fix rather than answering from a lesser copy of itself.

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
