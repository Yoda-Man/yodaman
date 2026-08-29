# Configuration

YodaMan reads persistent workspace configuration from local `config.json` and runtime settings from environment variables. Releases ship `config.example.json`; each support machine should keep its own ignored `config.json`.

## `config.json`

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ]
}
```

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `watchedDirectories` | `string[]` | Yes | Absolute workspace paths that YodaMan should watch, index, and expose to chat, search, and agent tasks. |
| `removedDirectories` | `string[]` | No | Deleted workspace paths that should not be re-added from stale Context Expert project metadata. |

Use absolute paths. The API validates submitted paths and normalizes them before storing or queueing work.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `YODAMAN_PORT` | `3090` | Express runtime port. |
| `YODAMAN_REQUIRE_PAIRING_TOKEN` | `true` | Non-local clients must send `X-YodaMan-Token` from the pairing flow. |
| `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS` | `false` | Allows plugins that declare unrestricted permissions. Keep disabled for normal use. |
| `YODAMAN_ALLOW_PLUGIN_UPLOADS` | `false` | Enables plugin uploads. Keep disabled except during trusted local support sessions. |
| `YODAMAN_ALLOW_AGENT_COMMANDS` | `false` | Enables agent shell command execution. Keep disabled except during trusted local support sessions. |
| `YODAMAN_WATCH_DEBOUNCE_MS` | `1500` | Debounce window for filesystem watcher reindex queueing. |
| `YODAMAN_GRAPHIFY_BIN` | `graphify` | Graphify executable path. Use this when `graphifyy` installs into a user Python bin directory outside `PATH`. |
| `YODAMAN_GRAPHIFY_TIMEOUT_MS` | `300000` | Timeout for Graphify build, query, explain, and path subprocesses. |
| `YODAMAN_GRAPHIFY_VIZ_NODE_LIMIT` | `25000` | Default Graphify HTML visualization node limit passed as `GRAPHIFY_VIZ_NODE_LIMIT`. Lower it for slower machines or raise it when large mind maps are acceptable. |
| `YODAMAN_GRAPHIFY_FULL_EXTRACT` | `false` | When `true`, use Graphify full semantic extraction through Ollama instead of the no-LLM update path. |
| `YODAMAN_GRAPHIFY_OLLAMA_MODEL` | `qwen3:5b` | Local Ollama model passed to Graphify when full extraction is enabled. |
| `VITE_YODAMAN_API_BASE` | `/api` | Frontend API base path. Use this when the UI talks through a proxy or alternate host. |
| `VITE_YODAMAN_FETCH_TIMEOUT_MS` | `30000` | Browser fetch timeout in milliseconds. |
| `YODAMAN_URL` | `http://127.0.0.1:$YODAMAN_PORT` | Where the `yodaman-mcp` server looks for the runtime. Set it only if the runtime is not on the default port. |
| `YODAMAN_MCP_TIMEOUT` | `120000` | Milliseconds before an MCP tool call gives up. Semantic search on a very large workspace can take tens of seconds. |

### Ollama's context window — set this

`OLLAMA_CONTEXT_LENGTH` belongs to Ollama, not YodaMan, but it shapes every
answer the agent gives and its default is usually wrong for this workload.

Ollama picks a default by VRAM — "4k/32k/256k" — and a typical laptop gets the
smallest tier. On this machine it served **4,096 tokens against a model
declaring 262,144**. The agent's prompt plus the chunks ctx retrieves overflowed
that, and `llama-server` runs with `--context-shift`, which drops from the
*front* — the system prompt carrying the tool instructions. The model answered
with its own instructions truncated away, and it read as a weak model for months.

Check what you are actually getting:

```bash
yodaman doctor          # reports the served window against the model's capability
```

It is also on the Dashboard's AI Engine card, in amber when it is small, with a
button that applies the recommended value and restarts Ollama for you.

To set it yourself, in the environment Ollama runs under:

```bash
# Homebrew service (macOS)
launchctl setenv OLLAMA_CONTEXT_LENGTH 32768
brew services restart ollama

# or when running it directly
OLLAMA_CONTEXT_LENGTH=32768 ollama serve
```

YodaMan adapts either way: it trims the prompt to fit a small window and stops
trimming once the window is large enough, so a bigger context buys better answers
rather than errors.

## Security notes

- Pairing tokens are temporary in-memory credentials for mobile and LAN clients.
- Local requests are allowed when pairing enforcement is enabled so the desktop/web UI can continue to operate.
- Graphify is mandatory. The runtime fails startup when the Graphify CLI cannot be found.
- Graphify is local-only in YodaMan. Cloud model provider keys are stripped from Graphify subprocesses, and full extraction forces `--backend ollama`.
- Plugin permissions are visible through `GET /api/policy`; review them before enabling third-party plugins.

## CLI health checks

Run a local Graphify health summary from the project root or installed package:

```bash
yodaman doctor --graph
```

The command reads `config.json`, checks each workspace's `graphify-out/graph.json`, reports active graph count, persisted freshness, orphaned nodes, and the most dependency-heavy source file.
