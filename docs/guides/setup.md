# Setup & Installation Guide

## Prerequisites

Only Node.js is needed to start. Everything else unlocks a capability, and the
runtime starts without any of them — a missing tool disables its features and
says so, rather than stopping the process. (`npm start` is stricter: see
[Installation](#installation).)

**Start here, and you get something in about five seconds:**

| Install | Unlocks | Cost |
| --- | --- | --- |
| **Node.js** v24+ | The runtime itself | — |
| **Graphify** — `python3 -m pip install --user --break-system-packages graphifyy` (Homebrew's Python refuses `--user` installs without the flag) | The knowledge graph, impact analysis, and the coverage finding: which load-bearing modules carry your codebase and what nothing describes | Small. Graph builds take **0–5 seconds** on a typical repo. |

That pair is enough to see the thing YodaMan does that other tools do not. It
needs no model download and no AI service.

**Then, when you want more:**

| Install | Unlocks | Cost |
| --- | --- | --- |
| **Context Expert** — `npm install -g yodaman-ctx` (1.3.4 or later; `yodaman setup` and `setup.sh` add the `--allow-scripts=...` list its native modules need) | Semantic code search, and the retrieval behind agent answers | Small |
| **OpenSpec** — `npm install -g @fission-ai/openspec@latest` | The Stardust spec workflow and spec coverage | Small |
| **Ollama** + a model | Chat and agent tasks, and Graphify's optional full semantic extraction | **Several GB** for the model. See [Choosing a model](../../README.md#choosing-a-model). |

Ollama is genuinely optional for the graph: extraction defaults to a local
no-LLM path, and only `YODAMAN_GRAPHIFY_FULL_EXTRACT=true` reaches for a model.

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

3. Install the tools (Mac only, uses Homebrew):
   ```bash
   sh setup.sh
   ```
   It installs whatever is missing of Homebrew, Node.js, Python 3, Ollama,
   Context Expert, Graphify and OpenSpec, runs `npm install`, then `npm start`.

4. Start the runtime and web UI:
   ```bash
   npm start
   ```
   `npm start` first checks for `ctx`, `graphify` and `ollama` and exits if any
   is missing. To start with only Node.js, run `npm run dev` instead.

The backend runtime listens on `http://127.0.0.1:3090`. The development web UI listens on `http://localhost:5190`.

## Configuration

YodaMan stores workspace configuration in `config.json` in the user's data folder (`~/Library/Application Support/YodaMan` on macOS, `%APPDATA%\YodaMan` on Windows, `~/.config/YodaMan` on Linux), not in the project. It is created when you add a workspace or change a setting; `config.example.json` shows the shape.

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ]
}
```

- **watchedDirectories**: A list of absolute paths that YodaMan will monitor for changes.
- **removedDirectories**: A local tombstone list for workspaces deleted from YodaMan so they are not re-added from stale index metadata.

YodaMan 0.6.6 creates Graphify artifacts inside each workspace under `graphify-out/`. Reindexing a workspace updates both Context Expert and Graphify.

Check Graphify graph health across configured workspaces:

```bash
yodaman doctor --graph
```

Runtime state (`sessions.json`, and `audit-log.json(l)` and `task-history.json(l)` when SQLite cannot be opened) is written to the same data folder, never to the install folder.

## Verification

Run the main checks before packaging:

```bash
npm test
npm run build
npm run release:smoke
```

## Optional Safety Flags

Pairing tokens for non-local clients are required by default. The runtime
binds `127.0.0.1`; to let a paired phone or LAN client reach it:

```bash
YODAMAN_HOST=0.0.0.0 npm start
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

## Two settings worth getting right

**The context window Ollama serves.** This is the highest-impact setting, and
its default is usually wrong for this workload — unset, Ollama picks by VRAM and
often serves 4,096 tokens no matter what the model supports. YodaMan scales what
it sends to match, so a large model through a small window performs like a small
one. See [Choosing a model](../../README.md#choosing-a-model).

```bash
export OLLAMA_CONTEXT_LENGTH=32768
```

**Lending the index to other agents.** If you use Cursor, Claude Code or Zed
alongside YodaMan, point them at the MCP server so they can search your private
code without it leaving the machine:

```bash
claude mcp add yodaman -- yodaman-mcp
```

See [MCP](mcp.md).

See `docs/guides/configuration.md` for the full configuration schema and runtime variable reference.
