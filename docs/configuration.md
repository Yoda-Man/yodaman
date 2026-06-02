# Configuration

YodaMan reads persistent workspace configuration from `config.json` and runtime settings from environment variables.

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
| `YODAMAN_REQUIRE_PAIRING_TOKEN` | `false` | When `true`, non-local clients must send `X-YodaMan-Token` from the pairing flow. |
| `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS` | `false` | Allows plugins that declare unrestricted permissions. Keep disabled for normal use. |
| `YODAMAN_GRAPHIFY_BIN` | `graphify` | Graphify executable path. Use this when `graphifyy` installs into a user Python bin directory outside `PATH`. |
| `YODAMAN_GRAPHIFY_TIMEOUT_MS` | `300000` | Timeout for Graphify build, query, explain, and path subprocesses. |
| `YODAMAN_GRAPHIFY_VIZ_NODE_LIMIT` | `25000` | Default Graphify HTML visualization node limit passed as `GRAPHIFY_VIZ_NODE_LIMIT`. Lower it for slower machines or raise it when large mind maps are acceptable. |
| `YODAMAN_GRAPHIFY_FULL_EXTRACT` | `false` | When `true`, use Graphify full semantic extraction through Ollama instead of the no-LLM update path. |
| `YODAMAN_GRAPHIFY_OLLAMA_MODEL` | `qwen3:5b` | Local Ollama model passed to Graphify when full extraction is enabled. |
| `VITE_YODAMAN_API_BASE` | `/api` | Frontend API base path. Use this when the UI talks through a proxy or alternate host. |
| `VITE_YODAMAN_FETCH_TIMEOUT_MS` | `30000` | Browser fetch timeout in milliseconds. |

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
