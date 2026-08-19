# Setup & Installation Guide

## Prerequisites

- **Node.js**: v18.0.0 or higher.
- **Context Expert (ctx)**: The intelligence engine must be installed globally.
  ```bash
  npm install -g @contextexpert/cli
  ```
- **Graphify**: The required knowledge graph engine must be installed and reachable as `graphify`.
  ```bash
  python3 -m pip install graphifyy
  graphify --help
  ```
- **Ollama**: Required for local AI model execution and Graphify full semantic extraction.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Yoda-Man/yodaman.git
   cd yodaman
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Initialize the ecosystem (Mac only):
   ```bash
   sh setup.sh
   ```

4. Start the runtime and web UI:
   ```bash
   npm start
   ```

The backend runtime listens on `http://localhost:3090`. The development web UI listens on `http://localhost:5190`.

## Configuration

YodaMan stores local workspace configuration in `config.json` at the root of the project. Releases ship `config.example.json`; copy it to `config.json` or use the app Settings screen to create local workspace configuration.

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ]
}
```

- **watchedDirectories**: A list of absolute paths that YodaMan will monitor for changes.
- **removedDirectories**: A local tombstone list for workspaces deleted from YodaMan so they are not re-added from stale index metadata.

YodaMan 0.5.0 creates Graphify artifacts inside each workspace under `graphify-out/`. Reindexing a workspace updates both Context Expert and Graphify.

Check Graphify graph health across configured workspaces:

```bash
yodaman doctor --graph
```

Runtime state files such as `audit-log.json`, `audit-log.jsonl`, `task-history.json`, and `task-history.jsonl` are local machine artifacts and are ignored by git.

## Verification

Run the main checks before packaging:

```bash
npm test
npm run build
npm run release:smoke
```

## Optional Safety Flags

Require pairing tokens for non-local clients:

```bash
YODAMAN_REQUIRE_PAIRING_TOKEN=true npm start
```

Allow intentionally trusted unrestricted plugins:

```bash
YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true npm start
```

Enable plugin uploads or agent shell commands only during trusted local support sessions:

```bash
YODAMAN_ALLOW_PLUGIN_UPLOADS=true npm start
YODAMAN_ALLOW_AGENT_COMMANDS=true npm start
```

Change the backend port:

```bash
YODAMAN_PORT=4090 npm start
```

Use an alternate API base from the web UI:

```bash
VITE_YODAMAN_API_BASE=http://localhost:4090/api npm run dev
```

Point YodaMan at a Graphify executable outside `PATH`:

```bash
YODAMAN_GRAPHIFY_BIN=/Users/you/Library/Python/3.14/bin/graphify npm start
```

Tune Graphify subprocess timeouts:

```bash
YODAMAN_GRAPHIFY_TIMEOUT_MS=180000 npm start
```

Tune Graphify HTML visualization size:

```bash
YODAMAN_GRAPHIFY_VIZ_NODE_LIMIT=25000 npm start
```

Enable Graphify full semantic extraction through Ollama only:

```bash
YODAMAN_GRAPHIFY_FULL_EXTRACT=true YODAMAN_GRAPHIFY_OLLAMA_MODEL=qwen3:5b npm start
```

Tune frontend request timeouts:

```bash
VITE_YODAMAN_FETCH_TIMEOUT_MS=45000 npm run dev
```

See `docs/guides/configuration.md` for the full configuration schema and runtime variable reference.
