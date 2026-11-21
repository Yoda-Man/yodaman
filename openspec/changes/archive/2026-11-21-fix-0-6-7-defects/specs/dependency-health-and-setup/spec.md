## MODIFIED Requirements

### Requirement: Checked tools
`DependencyChecker.SERVICES` SHALL define exactly four tools, checked in this order: `ollama`, `ctx`, `graphify` and `openspec`. `checkAll()` SHALL return one `check()` result per tool, keyed by name, and every planner and report SHALL read this one list.

#### Scenario: Executables and probes
- **WHEN** the tools are checked
- **THEN** `ollama` (`ollama.exe` on Windows) is run with `--version`, `ctx` with `--version`, `graphify` with `--help` and `openspec` with `--version`
- **AND** only `ollama` has a running check, `GET <Ollama address>/api/tags` with a 2000 ms timeout

#### Scenario: Ollama address
- **WHEN** any part of the runtime calls Ollama (the running check, the context probe, the search summary)
- **THEN** it uses `OllamaConfig.ollamaUrl()`: `OLLAMA_HOST` read as the ollama CLI reads it (scheme optional, default port 11434, `0.0.0.0` meaning this machine), else `http://127.0.0.1:11434`
- **AND** an unparseable `OLLAMA_HOST` falls back to `http://127.0.0.1:11434`

#### Scenario: Result shape
- **WHEN** `check(name)` finishes
- **THEN** it returns `name`, `found`, `path`, `version`, `running`, `runningUrl`, `installUrl`, `installHint`, `error` and `ok`
- **AND** `ok` is true only when the tool is found and `running` is not `false`

### Requirement: Proven to start
`locate(name)` SHALL always run the tool's probe command with a 10 second timeout. A tool that is present but fails to run, or a `ctx` older than `minVersion` `1.3.4`, SHALL be reported with `found: false` so setup and Repair reinstall it.

#### Scenario: Not on the machine
- **WHEN** no executable is found
- **THEN** the result is `found: false`, `path: null`, `error: "<name> not found"` and `installHint` is the platform hint, or `installUrl` when there is none

#### Scenario: Present but broken
- **WHEN** the probe exits with an error and prints no version
- **THEN** `error` is `<name> is installed at <path> but fails to run: <reason>`
- **AND** when the cause is a missing `#!` interpreter the reason is `the interpreter on its first line, <interpreter>, no longer exists; reinstall it`

#### Scenario: ctx too old
- **WHEN** `ctx --version` prints `1.3.2`
- **THEN** the result is `found: false` with error `ctx 1.3.2 is installed at <path> but YodaMan needs 1.3.4 or newer`

#### Scenario: Graphify version label
- **WHEN** `graphify --help` succeeds
- **THEN** `version` is the label `installed`, because `--help` prints no version

### Requirement: Install commands
Each tool SHALL carry an `installUrl` and a per-platform `installHint`. The ctx command SHALL be the single string `CTX_INSTALL`, used for `installUrl` and for every platform hint.

#### Scenario: ctx install command
- **WHEN** any caller asks how to install ctx
- **THEN** the command is `npm install -g yodaman-ctx --allow-scripts=better-sqlite3,protobufjs,sharp,tree-sitter,tree-sitter-javascript,tree-sitter-python,tree-sitter-typescript,tree-sitter-go,tree-sitter-rust,tree-sitter-java,tree-sitter-c-sharp,tree-sitter-c,tree-sitter-cpp,tree-sitter-php,tree-sitter-ruby,tree-sitter-powershell,onnxruntime-node`

#### Scenario: Other tools
- **WHEN** the hints are read on macOS
- **THEN** Ollama is `brew install ollama  or  download from https://ollama.com/download`, Graphify is `python3 -m pip install --user --break-system-packages graphifyy` and OpenSpec is `npm install -g @fission-ai/openspec@latest`
- **AND** on Linux Ollama is `curl -fsSL https://ollama.com/install.sh | sh` and Graphify is `python3 -m pip install --user graphifyy`; on Windows Graphify is `py -m pip install graphifyy`

### Requirement: Startup health state
`server.js` SHALL keep one `healthState` object, set on the app as `healthState`, starting with `started: false` and every check at `{ ok: null, message: "not checked" }`. Startup SHALL fill it without ever stopping the process, then set `started: true` and log `startup_health_summary`.

#### Scenario: Startup order
- **WHEN** the runtime starts listening
- **THEN** Graphify is checked with `graphify --help` (message `available` on success), then `ollama`, `ctx` and `openspec` through `DependencyChecker.check` and `healthEntry`, then `config.json` is read (message `loaded (<n> dirs)`), then projects are synced from `ctx list`
- **AND** a missing tool logs `startup_dependency_missing` as a warning, not an error

#### Scenario: Health entry text
- **WHEN** `healthEntry` turns a found Ollama result into a health entry with `includeRunning`
- **THEN** the message is `v<version> at <path> (running)` or `(not running)`
- **AND** a version that does not start with a digit gets no `v`: Graphify after Repair reads `installed at <path>`
- **AND** a missing tool's message is the check's `error`

### Requirement: External health watchdog
`scripts/health-watchdog.js` (`npm run health:watch`, and `npm run health:check` for `--once`) SHALL probe `<YODAMAN_HEALTH_URL>/api/health` from outside the runtime and classify each probe as `healthy`, `slow`, `wedged` or `down`.

#### Scenario: Settings
- **WHEN** no environment is set
- **THEN** it probes `http://127.0.0.1:3090` every 30000 ms (`YODAMAN_WATCH_INTERVAL`) with a 10000 ms timeout (`YODAMAN_WATCH_TIMEOUT`) and warns above 3000 ms (`YODAMAN_WATCH_WARN`)
- **AND** with `YODAMAN_HEALTH_URL` unset it probes `http://127.0.0.1:<YODAMAN_PORT>`, and the port checked with `lsof` is always the probed URL's port

#### Scenario: Verdicts
- **WHEN** the probe times out or fails and `lsof` shows the port listening
- **THEN** the state is `wedged`; with nothing listening it is `down`
- **AND** a non-2xx answer or one slower than the warn budget is `slow`

#### Scenario: One probe
- **WHEN** run with `--once`
- **THEN** the exit code is 0 healthy, 1 wedged, 2 down or 3 slow
- **AND** `--json` prints one JSON line per probe with `timestamp`, `url`, `state` and `elapsedMs`

#### Scenario: Watching
- **WHEN** run without `--once`
- **THEN** it prints `Watching <url> every <n>s. Ctrl-C to stop.` and then only prints a probe when it is not healthy or the previous one was not healthy

### Requirement: setup.sh
`setup.sh` SHALL take no flags, run with `set -e`, and check then install in this order: Homebrew, Node.js, Python 3, Ollama, ctx, Graphify and OpenSpec. It SHALL then run `npm install` and `npm start`.

#### Scenario: Missing tools
- **WHEN** a tool's command is not found
- **THEN** Homebrew is installed from its official install script, Node with `brew install node`, Python with `brew install python`, Ollama with `brew install ollama`
- **AND** ctx with the same `npm install -g yodaman-ctx --allow-scripts=...` command as `CTX_INSTALL`, OpenSpec with `npm install -g @fission-ai/openspec@latest`

#### Scenario: Graphify
- **WHEN** `graphify` is neither on PATH nor in `~/Library/Python/*/bin`
- **THEN** it runs `python3 -m pip install --user graphifyy`, and on failure `python3 -m pip install --user --break-system-packages graphifyy`

#### Scenario: Minimum versions
- **WHEN** Node.js is present but older than `NODE_MIN_MAJOR` (24, the `engines` field of `package.json`)
- **THEN** it prints `Too old (<version>)` and `YodaMan needs Node.js 24 or newer. Upgrade it (brew upgrade node, or nvm install 24) and run setup.sh again.` and exits 1
- **AND** a `ctx` older than `CTX_MIN_VERSION` (DependencyChecker's `minVersion`, 1.3.4), or one that does not report a version, prints `Too old (<version>); YodaMan needs 1.3.4 or newer` and is reinstalled with the `CTX_INSTALL` command

#### Scenario: Present and new enough
- **WHEN** a tool is present and meets its minimum (Ollama, Python, Graphify and OpenSpec have none)
- **THEN** the script prints OK and does not upgrade it
