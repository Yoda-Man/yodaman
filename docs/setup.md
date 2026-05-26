# Setup & Installation Guide

## Prerequisites

- **Node.js**: v18.0.0 or higher.
- **Context Expert (ctx)**: The intelligence engine must be installed globally.
  ```bash
  npm install -g @contextexpert/cli
  ```
- **Ollama**: (Optional but recommended) For local AI model execution.

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

YodaMan stores its configuration in `config.json` at the root of the project.

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ]
}
```

- **watchedDirectories**: A list of absolute paths that YodaMan will monitor for changes.

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

Change the backend port:

```bash
YODAMAN_PORT=4090 npm start
```

Use an alternate API base from the web UI:

```bash
VITE_YODAMAN_API_BASE=http://localhost:4090/api npm run dev
```

Tune frontend request timeouts:

```bash
VITE_YODAMAN_FETCH_TIMEOUT_MS=45000 npm run dev
```

See `docs/configuration.md` for the full configuration schema and runtime variable reference.
