# Configuration

YodaMan reads persistent workspace configuration from `config.json` and runtime settings from environment variables. `config.json` lives in the user's data folder (`~/Library/Application Support/YodaMan` on macOS, `%APPDATA%\YodaMan` on Windows, `~/.config/YodaMan` on Linux), outside the install, so upgrades keep it; the Dashboard shows its path under **Your Data**. `YODAMAN_DATA_DIR` moves the folder and `YODAMAN_CONFIG_PATH` points at a single file. Releases ship `config.example.json` as a starting point.

## `config.json`

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ],
  "removedDirectories": [],
  "settings": {
    "requirePairingToken": true,
    "allowAgentCommands": false
  }
}
```

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `watchedDirectories` | `string[]` | `[]` | Absolute workspace paths that YodaMan should watch, index, and expose to chat, search, and agent tasks. |
| `removedDirectories` | `string[]` | `[]` | Deleted workspace paths that should not be re-added from stale Context Expert project metadata. |
| `settings` | object | see below | Security and editor settings. Settings writes this block; missing keys take the defaults below. |

Use absolute paths. The API validates submitted paths and normalizes them before storing or queueing work.

### `settings`

Settings can be changed in the app, or through `PUT /api/settings`, only from this computer: a device holding a pairing token cannot change them. Each setting can also be overridden by an environment variable named after it (`allowPluginUploads` → `YODAMAN_ALLOW_PLUGIN_UPLOADS`). An environment value wins over `config.json`; `true`/`false` become booleans and `allowedCommands` takes a comma-separated list.

| Key | Default | Description |
| --- | --- | --- |
| `requirePairingToken` | `true` | Non-local clients must send `X-YodaMan-Token` from the pairing flow. |
| `allowUnrestrictedPlugins` | `false` | Allows plugins that declare unrestricted permissions. Keep disabled for normal use. |
| `allowPluginUploads` | `false` | Enables plugin uploads. Keep disabled except during trusted local support sessions. |
| `allowAgentCommands` | `false` | Enables agent shell command execution. Keep disabled except during trusted local support sessions. |
| `allowSelfHealInstall` | `false` | Lets **Repair** on the Dashboard run the npm and pip installs for Context Expert, Graphify and OpenSpec (never Ollama, never sudo), from this computer only. |
| `allowedCommands` | `[]` | Extra executable names the agent may run, on top of the built-in allowlist. Bare names only. |
| `editorCommand` | `""` | How files open from search results and chat links. Empty or `system` uses the OS default app for the file type; an app bundle path opens that app; anything else is a command template such as `idea --line {line} {file}`. |

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `YODAMAN_PORT` | `3090` | Express runtime port. |
| `YODAMAN_HOST` | `127.0.0.1` | Address the runtime binds. Set `0.0.0.0` only to let paired mobile or LAN clients reach it. |
| `YODAMAN_DATA_DIR` | per-OS data folder | Moves the data folder (`config.json`, `yodaman.db`). |
| `YODAMAN_CONFIG_PATH` | `<data folder>/config.json` | Points at a single config file. |
| `YODAMAN_DB_PATH` | `<data folder>/yodaman.db` | Points at a single database file. |
| `YODAMAN_LOG_TO_FILE` | `true` (off under Jest) | Writes `runtime.log`. |
| `YODAMAN_LOG_DIR` | `~/.yodaman/logs` | Folder for `runtime.log`. |
| `YODAMAN_LOG_MAX_BYTES` / `YODAMAN_LOG_MAX_FILES` | `5242880` / `3` | Log rotation size and number of rotated files kept. |
| `YODAMAN_UPLOAD_ROOT` | `<os tmpdir>/yodaman-agent-uploads` | Where files attached to agent tasks are stored. |
| `YODAMAN_CTX_ASK_TIMEOUT_MS` | `12000` | Timeout for the `ctx ask` call behind `POST /api/ask` before it falls back. |
| `YODAMAN_AGENT_PROMPT_CHARS` | sized to the served context window | Sets the agent's prompt budget in characters instead (at most 120,000). |
| `YODAMAN_WATCH_DEBOUNCE_MS` | `1500` | Debounce window for filesystem watcher reindex queueing. |
| `YODAMAN_GRAPHIFY_BIN` | auto-detected | Graphify executable path. Without it YodaMan searches `PATH` and the user Python bin directories, then falls back to `graphify`. Set it when `graphifyy` is installed somewhere else. |
| `YODAMAN_GRAPHIFY_TIMEOUT_MS` | `300000` | Timeout for Graphify build, query, explain, and path subprocesses. |
| `YODAMAN_GRAPHIFY_RUNNING_STALE_MS` | twice the timeout + 60000 | Age after which a build still marked running is treated as stale. |
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
- Graphify unlocks the graph, impact analysis, and the coverage finding. The
  runtime starts without it; those features report what is missing instead.
- Graphify is local-only in YodaMan. Cloud model provider keys are stripped from Graphify subprocesses, and full extraction forces `--backend ollama`.
- Plugin permissions are visible through `GET /api/policy`; review them before enabling third-party plugins.

## CLI health checks

Run a local Graphify health summary from the project root or installed package:

```bash
yodaman doctor --graph
```

The command reads the runtime's own `config.json` (not one in the current directory), checks each workspace's `graphify-out/graph.json`, reports active graph count, persisted freshness, orphaned nodes, and the most dependency-heavy source file.
