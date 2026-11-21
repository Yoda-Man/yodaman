## MODIFIED Requirements

### Requirement: Command set
`yodaman` SHALL print help when the first argument is `help` or any argument is `--help` or `-h`. Otherwise it SHALL dispatch on its first argument: `--version`, `-v` or `version`; `uninstall` or `clean`; `setup` or `install`; `create-plugin <name>`; `doctor` (with `--graph` or `--json`). Any other first argument, or none, SHALL start the runtime.

#### Scenario: No arguments
- **WHEN** the user runs `yodaman`
- **THEN** it prints `🚀 Starting YodaMan...` and spawns `node server.js` from the package root with `NODE_ENV=production` and inherited stdio
- **AND** it exits with the runtime's exit code, or 0

#### Scenario: Unknown argument
- **WHEN** the user runs `yodaman start`
- **THEN** the runtime starts exactly as with no arguments

#### Scenario: Help after a command
- **WHEN** the user runs `yodaman setup --help`, `yodaman doctor --help` or `yodaman uninstall -h`
- **THEN** it prints the help text and exits 0 without running that command

### Requirement: Help and version
Help and version MUST be answered before any backend module is loaded, so they print only their answer and exit 0 without starting the runtime.

#### Scenario: Help text
- **WHEN** the user runs `yodaman --help`
- **THEN** it prints `YodaMan <version> — local-first workspace intelligence` and lists `yodaman` (with `http://localhost:<YODAMAN_PORT or 3090>`), `setup`, `uninstall`, `doctor`, `doctor --graph`, `create-plugin <n>`, `--help, -h`, `--version, -v`, `setup --dry-run`, `setup --yes`, `uninstall`, `uninstall --yes`
- **AND** it ends with `Docs: https://github.com/Yoda-Man/yodaman`

#### Scenario: Version
- **WHEN** the user runs `yodaman -v`
- **THEN** stdout is only the `version` from package.json, for example `0.6.6`

### Requirement: Uninstall is a dry run by default
`yodaman uninstall` SHALL print the uninstall plan and delete nothing unless `--yes` or `-y` is given. The plan MUST be identical with and without the flag.

#### Scenario: Dry run
- **WHEN** the user runs `yodaman uninstall` and the plan has items to remove
- **THEN** it prints the plan and `Nothing was deleted. Re-run with --yes to remove the <n> item(s) above.` and exits 0

#### Scenario: Plan contents
- **WHEN** the plan is built
- **THEN** it lists `~/.yodaman`, the runtime config.json and yodaman.db, each state file of `DATA_FOLDER_STATE` in `shared/generatedPaths.js` that exists in the data folder (`sessions.json`, `plugins.json`, `audit-log.json`, `audit-log.jsonl`, `task-history.json`, `task-history.jsonl`), and each workspace's `.yodaman-doc-chunks` and `graphify-out`
- **AND** the data folder itself and anything else in it is never listed
- **AND** the manual step `npm uninstall -g yodaman` says it removes the program itself, never the data files listed
- **AND** each workspace's `openspec` folder is listed as protected and never removed, and a workspace that is a filesystem root or too broad is skipped

#### Scenario: Confirmed removal
- **WHEN** the user runs `yodaman uninstall --yes`
- **THEN** each listed path is removed recursively, printed as `removed <path>`, then `<n> removed.`
- **AND** if any removal failed it prints `Could not remove:` with each path and reason and exits 1

### Requirement: Plugin scaffold
`yodaman create-plugin <name>` SHALL write `plugins/<name>.js` and `plugins/<name>.test.js` in the package's own `plugins/` folder and append a `## <name>` section to `plugins/README.md`. The scaffold MUST declare `permissions: ['read']` and an `execute` that throws `target is required` without `target`.

#### Scenario: Missing name
- **WHEN** the user runs `yodaman create-plugin`
- **THEN** it prints `Usage: yodaman create-plugin <plugin-name>` and exits 1

#### Scenario: Invalid name
- **WHEN** the name does not match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, for example `../x`
- **THEN** it prints `Invalid plugin name "<name>": use a letter, then letters, digits, - or _ (at most 64).`, writes nothing and exits 1

#### Scenario: Existing plugin
- **WHEN** `plugins/<name>.js` already exists
- **THEN** it prints `Plugin "<name>" already exists at <path>` and exits 1

#### Scenario: README already has the entry
- **WHEN** plugins/README.md already contains `## <name>`
- **THEN** the README is left unchanged and the CLI says so

### Requirement: npm start launcher
`npm start` SHALL run `start.js`, which checks for `ctx`, Graphify and Ollama and then runs `npm run dev` (the runtime and the Vite dev server on port 5190). A missing dependency MUST stop it with exit code 1.

#### Scenario: Graphify lookup
- **WHEN** start.js looks for Graphify
- **THEN** it uses `YODAMAN_GRAPHIFY_BIN` if set, else the first `~/Library/Python/<version>/bin/graphify`, else `graphify` on PATH

#### Scenario: Graphify missing
- **WHEN** `<graphify> --help` fails
- **THEN** it prints `Install it with: python3 -m pip install --user graphifyy` and the `YODAMAN_GRAPHIFY_BIN` hint and exits 1

### Requirement: MCP server transport
`yodaman-mcp` SHALL serve the Model Context Protocol over stdio as server `yodaman` with the package version. stdout MUST carry only protocol messages, and diagnostics SHALL go to stderr prefixed `[yodaman-mcp] `.

#### Scenario: Ready
- **WHEN** the server connects its stdio transport
- **THEN** stderr gets `[yodaman-mcp] v<version> ready on stdio, proxying <runtime> (read-only)`

#### Scenario: Runtime address
- **WHEN** the server starts
- **THEN** the runtime is `YODAMAN_URL`, else `http://127.0.0.1:<YODAMAN_PORT or 3090>`, and each request times out after `YODAMAN_MCP_TIMEOUT` ms (default 120000)

### Requirement: MCP errors name the fix
When the runtime cannot be reached the tool call SHALL fail with a message that tells the user how to start YodaMan. A non-2xx answer SHALL fail with the status, the route and the runtime's `error` when one is given.

#### Scenario: Runtime down
- **WHEN** the runtime is not listening
- **THEN** the error is `the runtime at <url> is not reachable. Start YodaMan (open the desktop app, or run \`yodaman\`), then try again. Nothing was read.`
- **AND** when `YODAMAN_PORT` is set to a port other than 3090 the command reads `YODAMAN_PORT=<port> yodaman`
- **AND** a timeout says `the runtime did not answer within <n>s` instead of the first clause

#### Scenario: HTTP error
- **WHEN** the runtime answers 404 with a JSON body `{ "error": "<message>" }`
- **THEN** the tool error is `YodaMan returned HTTP 404 for <route> — <message>`
- **AND** a non-JSON error body gives the same text without the ` — <message>` suffix
