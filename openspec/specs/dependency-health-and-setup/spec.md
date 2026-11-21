# Dependency Health and Setup Specification

## Purpose
YodaMan needs four outside tools: Ollama, Context Expert (`ctx`), Graphify and OpenSpec. This capability covers how they are found and proven to start (`backend/infrastructure/DependencyChecker.js`), the doctor report (`DependencyDoctor.js`), the install plans for setup and Repair (`SetupPlanner.js`) and uninstall (`UninstallPlanner.js`), the health routes in `backend/interfaces/RestController.js` with the `healthState` object from `server.js`, the external watchdog `scripts/health-watchdog.js`, and `setup.sh`.

## Requirements

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

### Requirement: Locating a tool
`which(name)` SHALL look in each `PATH` directory, then the platform's known install folders (`PLATFORM_PATHS`, with `*` folders expanded), then `which` on macOS and Linux, then `brew --prefix` on macOS, then `where` on Windows. A file SHALL count only when it is a regular file whose `#!` interpreter, if absolute, still exists.

#### Scenario: PATH widened at load
- **WHEN** the module is first loaded
- **THEN** existing NVM, Homebrew, Linuxbrew, Snap, Flatpak, fnm, Scoop, Chocolatey, `~/.local/bin` and `~/bin` folders are added to `process.env.PATH`
- **AND** an `info` log line `dependency_path_augmented` records how many were added

#### Scenario: Launcher whose Python was removed
- **WHEN** a `graphify` file is on PATH but its first line names `/opt/homebrew/opt/python@3.12/bin/python3.12` and that file no longer exists
- **THEN** `which` skips that file and keeps searching

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

### Requirement: GET /api/health
`GET /api/health` SHALL always answer 200 with `status`, `contextWindow`, `started`, `uptimeSeconds`, `checks`, `degraded`, `pending`, `services`, `projects`, `readiness`, `memory`, `platform`, `tasks` and `plugins`. `status` SHALL be `starting` before startup ends, `degraded` when any check has `ok: false`, and `ok` otherwise.

#### Scenario: Checks reported
- **WHEN** the health report is built
- **THEN** `checks` holds `node`, `runtime`, `graphify`, `ollama`, `ctx`, `openspec` and `config`, each with a `version` field (null when unknown)
- **AND** `runtime.message` is `PID <pid>, listening on port <port>` using the port the app serves

#### Scenario: Pending during startup
- **WHEN** startup has not finished and a check is still `not checked`
- **THEN** that check reports `ok: null` and its name is in `pending`, not `degraded`

#### Scenario: Context window advisory
- **WHEN** the Ollama context probe fails
- **THEN** `contextWindow` is `null` and the rest of the report is unchanged
- **AND** otherwise it is `{ declared, configured, effective, small, advice }`, where `configured` and `effective` come from `OLLAMA_CONTEXT_LENGTH` in the Homebrew Ollama plist, else in the runtime's environment, and `small` is true below 8192 or when unset
- **AND** the probe is cached for 5 minutes per model and configured value, so a change made with `POST /api/ollama/context` is reported by the next `/api/health`

#### Scenario: Logging transitions only
- **WHEN** the page polls and the status and degraded list have not changed
- **THEN** nothing is logged; a change logs `health_report_degraded` (warn) or `health_report_changed` (info)

### Requirement: GET /api/status and GET /api/check
`GET /api/status` SHALL report Context Expert from `ctx status --json` and SHALL answer 200 with `ok: false` instead of failing when ctx does not work. `GET /api/check?path=` SHALL report one folder's index health.

#### Scenario: ctx unavailable
- **WHEN** `ctx status` fails
- **THEN** the response has `version: "ctx-unavailable"`, `ok: false`, `error` and `hint: "Context Expert is not working. Use Repair on the Dashboard, or run: <ctx install command>"`

#### Scenario: Folder not indexed by ctx
- **WHEN** `path` is an existing folder that `ctx list` does not know
- **THEN** the response is `{ status: "healthy", name, path, ctxManaged: false }`
- **AND** a path that does not exist returns 404 `{ error: "Path not found", status: "missing" }`, and a missing `path` returns 400 with code `invalid_path`

#### Scenario: Indexed folder
- **WHEN** the path matches a ctx project
- **THEN** the response is the output of `ctx check <name> --json` plus `name` and `path`

### Requirement: Doctor report
`GET /api/diagnostics/run` SHALL run `runDependencyDoctor()` and answer `{ ok, report, text }`. Every one of the four tools SHALL be `required: true`, and the report SHALL be ok only when none is missing and none is installed but not responding.

#### Scenario: Report shape
- **WHEN** the doctor runs
- **THEN** `report` has `dependencies`, `missing`, `notRunning`, `ok`, `checkedAt` and `context` (the Ollama context probe, or null)
- **AND** it logs `dependency_doctor_completed`

#### Scenario: Text output
- **WHEN** `text` is rendered
- **THEN** it starts with `YodaMan dependency health`, prints `v<version>` only for numeric versions and `(installed)` for Graphify
- **AND** when not ok it ends with a line starting `⚠️ Degraded:` and a tip to run `yodaman doctor --graph`

#### Scenario: Doctor fails
- **WHEN** the doctor throws
- **THEN** the route answers 500 with code `diagnostics_run_failed`

### Requirement: Setup plan
`buildSetupPlan` SHALL sort every tool in `SERVICES` into `satisfied`, `automatic` or `manual`. Only `ctx`, `graphify` and `openspec` SHALL be automatic, and only when their hint is one plain command. `GET /api/setup/plan` SHALL return the plan for this machine and install nothing.

#### Scenario: Refused hints
- **WHEN** a hint starts with `http://` or `https://`, contains ` or `, `sudo` or `download from`
- **THEN** it is not runnable and the tool goes to `manual`

#### Scenario: Ollama missing
- **WHEN** Ollama is not found
- **THEN** it is always `manual` with reason `installs a system service, so it is left to you`
- **AND** `ok` is false

#### Scenario: Plan fails
- **WHEN** building the plan throws
- **THEN** the route answers 500 with code `setup_plan_failed`

### Requirement: POST /api/setup/repair
Repair SHALL run the plan's automatic commands without a shell, one at a time with a 10 minute timeout each, then check every tool again. It MUST be refused unless `allowSelfHealInstall` is on and the request comes from this computer, and only one repair SHALL run at once.

#### Scenario: Turned off
- **WHEN** `allowSelfHealInstall` is false
- **THEN** the answer is 403 code `self_heal_install_disabled`, error `Repair is turned off. Turn on "Repair can install missing tools" in Settings, or run the command yourself.`

#### Scenario: Not this computer or already running
- **WHEN** the request is not from loopback
- **THEN** the answer is 403 code `repair_local_only`, `Repairs can only be started from this computer`
- **AND** a second request while one runs gets 409 code `repair_running`, `A repair is already running`

#### Scenario: Repair finished
- **WHEN** the commands have run
- **THEN** the answer is `{ installed, manual, failed, stillMissing }`, one failed command does not stop the others
- **AND** `healthState` is updated for each installed tool so `/api/health` shows the result without a restart, and `setup_repair_finished` is logged

### Requirement: Desktop diagnostics
`GET /api/desktop/diagnostics` SHALL return `runtime` (pid, uptime, Node version, platform, cwd, memory), `host`, `tasks`, `data` (from `DataPaths.describeDataFiles`), `plugins` and `dependencies`. It MUST NOT fail before startup has registered `healthState`.

#### Scenario: Before startup
- **WHEN** `healthState` is not set
- **THEN** `dependencies.ollama`, `ctx`, `graphify` and `openspec` are each `null` and the status is 200

### Requirement: Uninstall plan
`buildUninstallPlan` SHALL only describe what removal would delete and SHALL never delete. It SHALL propose only `~/.yodaman`, the given data files, and `graphify-out` and `.yodaman-doc-chunks` inside known workspaces, and MUST NOT propose `openspec/` or any workspace that is a root, the home folder or a direct child of home.

#### Scenario: Dangerous workspace
- **WHEN** config lists `/` or `~/Documents` as a workspace
- **THEN** it is placed in `skipped` with `too broad to be a workspace — refusing`

#### Scenario: User specs kept
- **WHEN** a workspace has an `openspec` folder
- **THEN** it is listed under `protected`, never under `remove`

#### Scenario: Ollama plist backup
- **WHEN** on macOS `~/Library/LaunchAgents/homebrew.mxcl.ollama.plist.yodaman-backup` exists
- **THEN** a manual step tells the user to restore it, and it is not deleted

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
