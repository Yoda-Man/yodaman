## MODIFIED Requirements

### Requirement: Version consistency
`scripts/bump-version.js` SHALL keep the version in thirteen anchored sites in step with `package.json`. With `--check` it SHALL change nothing and exit 1 when any site does not carry the `package.json` version, or when any doc in the working tree names another version beside "YodaMan" or "Version". It SHALL NOT touch `CHANGELOG.md` or `packaging/homebrew/yodaman.rb`.

#### Scenario: The thirteen sites
- **WHEN** the script checks or bumps
- **THEN** it covers `package.json`, `extensions/vscode-yodaman/package.json`, `apps/mobile/app.json` (their `"version"` fields), the `Version-<v>-gold` badge in `README.md`, `Version: <v>` in `user_manual.md`, `YodaMan v<v>` in `docs/architecture/architecture.md`, `(<v>)` in `docs/guides/Management-Overview.md`, `YodaMan <v>` in `docs/guides/setup.md`, `` `<v>` `` in `website/README.md`, `downloads/...<v>` in `website/index.html`, `<p class="version">Version <v></p>` and `YodaMan <v>` in `public/manual.html`, `vscode-yodaman-<v>.vsix` in `extensions/vscode-yodaman/PUBLISHING.md` and `placeholder: "<v>"` in `.github/ISSUE_TEMPLATE/bug_report.yml`
- **AND** the `website/index.html` rewrite changes only `downloads/` links, never prose that names the old version
- **AND** `apps/mobile/package.json` keeps its own independent version and is not bumped

#### Scenario: Check passes
- **WHEN** every site carries the `package.json` version and the user runs `npm run version:check`
- **THEN** it prints `All 13 version sites, and every doc that names a version, agree on <version>.` and exits 0

#### Scenario: Check finds drift
- **WHEN** a site lacks the version or a listed file is missing
- **THEN** it prints `Version drift against package.json (<version>):` to stderr, one line per problem (`<file> (<describe>) does not carry <version>` or `<file> — listed here but not in the repository`), then `Run: node scripts/bump-version.js <version>`
- **AND** it exits 1

#### Scenario: A doc names another version
- **WHEN** a `.md`, `.html`, `.yml`, `.yaml` or `.txt` file that git tracks or would add (not `CHANGELOG.md`, `UPGRADING.md`, `packaging/`, `openspec/`, `tests/` or a dot-folder other than `.github/`) names `YodaMan <x.y.z>`, `YodaMan v<x.y.z>`, `Version <x.y.z>` (with `:`, `-` or `**` between) or a `YodaMan-`, `yodaman-` or `vscode-yodaman-<x.y.z>` file name for a version other than `package.json`'s
- **THEN** the check reports `<file> names "<text>", not <version> — add it to SITES or correct it` and exits 1

### Requirement: Vendored library audit
`scripts/audit-vendored.js` SHALL audit the packages recorded in `public/vendor/MANIFEST.json`, because they ship to users but are dev dependencies that `audit:prod` skips. It SHALL exit 1 when one has an `npm audit` advisory at or above `VENDOR_AUDIT_LEVEL` (default `moderate`).

#### Scenario: Unknown level
- **WHEN** `VENDOR_AUDIT_LEVEL` is not one of `info`, `low`, `moderate`, `high`, `critical`
- **THEN** it prints `Unknown VENDOR_AUDIT_LEVEL "<value>". Use one of: info, low, moderate, high, critical.` and exits 1 before auditing

#### Scenario: No manifest
- **WHEN** `public/vendor/MANIFEST.json` does not exist
- **THEN** it prints `No public/vendor/MANIFEST.json. Run "npm run vendor:sync" first.` and exits 1

#### Scenario: Clean
- **WHEN** no vendored package has an advisory at or above the threshold
- **THEN** it prints `  vendored  <file> @ <version>` for each versioned asset and `Vendored libraries clean at "moderate" and above.`

#### Scenario: Advisory found
- **WHEN** a vendored package such as `vis-network` has a moderate or higher advisory
- **THEN** it prints `Vendored libraries ship to users and have advisories:`, then `  <name>: <severity> (affected <range>)` and `Upgrade the package, then run "npm run vendor:sync".`
- **AND** it exits 1, and also exits 1 with `Could not parse npm audit output.` when the audit JSON is unreadable

### Requirement: Release file smoke
`npm run release:smoke` SHALL assert that the release files exist, that key entry files pass `node --check`, that the npm `files` list holds the required entries and that each plain entry exists. It SHALL load `Database.js` with `YODAMAN_DATA_DIR` set to a fresh temp folder and exit non-zero on any failure.

#### Scenario: Required files
- **WHEN** a required file such as `shared/yodamanClient.d.ts`, `apps/mobile/App.js` or `electron-builder.json` is missing
- **THEN** it throws `Missing release file: <path>` and exits non-zero

#### Scenario: Syntax check
- **WHEN** `node --check` fails for a checked file such as `server.js`, `electron/main.js` or `extensions/vscode-yodaman/src/extension.js`
- **THEN** it throws `node --check failed for <path>` with the checker output

#### Scenario: Package files list
- **WHEN** `package.json` `files` lacks one of `bin`, `dist`, `backend`, `shared`, `server.js`, `start.js`, `public`, `README.md`, `user_manual.md`, `config.example.json`
- **THEN** it throws `package.json files is missing <entry>`
- **AND** a non-negated entry without `*` that does not exist on disk throws `package.json files entry "<entry>" does not exist`

#### Scenario: Pass
- **WHEN** all checks pass and `Database.js` exports a boolean `useSqlite`
- **THEN** it prints `Release smoke checks passed.`; otherwise it throws `Database.js did not export useSqlite boolean`

### Requirement: Journey smoke
`npm run test:journeys` SHALL check search ranking and workspace readiness over HTTP against a runtime it starts from the working tree on port 3097 (`YODAMAN_SMOKE_PORT`), or against `YODAMAN_SMOKE_URL` when set. It SHALL exit 1 on a failed check and exit 0 with a SKIP when there is no runtime and no Ollama.

#### Scenario: No local stack
- **WHEN** nothing answers `<runtime>/api/health` and Ollama's `/api/tags` (at `OllamaConfig.ollamaUrl()`, which honours `OLLAMA_HOST`) is unreachable
- **THEN** it prints `SKIP: no runtime and no Ollama — these journeys need the local stack.` and exits 0

#### Scenario: Starting a runtime
- **WHEN** no runtime answers but Ollama does
- **THEN** it spawns `server.js` with `YODAMAN_PORT` set to the smoke port, a fresh temp `YODAMAN_DATA_DIR` holding a copy of the user's config.json, and logs to `YODAMAN_LOG_DIR` (default `<tmpdir>/yodaman-smoke-logs`)
- **AND** the runtime's sessions, task history and audit log go to that temp folder, which is removed when the run ends
- **AND** the plugin and approval gates (`plugin-smoke.js`, `approval-smoke.js`) start their runtime the same way, and every script or test that spawns `server.js` sets `YODAMAN_DATA_DIR` (`tests/architecture/SmokeRuntimesUseTempData.test.js`)
- **AND** if `/api/health` is not healthy within 45 seconds it kills the child and fails with `Journey smoke errored: Runtime did not become healthy in time.`
- **AND** a runtime it did not start is reported with `WARNING: reusing a runtime already on <url> that this gate did not start.`

#### Scenario: Search ranking
- **WHEN** up to four indexed workspaces with files are searched via `GET /api/search?query=<term>&project=<path>` for terms taken from connected graph files
- **THEN** the check fails if `weights` lacks any of `semantic`, `proximity`, `centrality`, `specCoverage`, if they do not sum to 1 within 0.001, or if `graphRanked` is false in every workspace tried
- **AND** it skips when no workspace is indexed or no workspace has a usable graph

#### Scenario: Readiness
- **WHEN** `GET /api/readiness` returns workspaces
- **THEN** the check fails if any lacks `state`, `layers.graph` or `layers.index`, or if a workspace whose `state` is not `ready` has no `action`
- **AND** on success it prints `All journey checks passed.`

### Requirement: Packaged app smoke
`npm run test:packaged` SHALL boot the `server.js` inside the unpacked desktop build under `release/` on port 3097 (`YODAMAN_PACKAGED_SMOKE_PORT`) with a fresh temp `YODAMAN_DATA_DIR`, and SHALL fail if it does not answer `/api/health` within 60 seconds or writes its database inside the bundle.

#### Scenario: No build present
- **WHEN** none of `release/mac-arm64/YodaMan.app/...`, `release/mac/YodaMan.app/...`, `release/linux-unpacked/resources/app/server.js` or `release/win-unpacked/resources/app/server.js` exists
- **THEN** it prints `SKIP: no packaged app found under release/ — run a desktop build first.` and exits 0, so the desktop build must come before the gate to test anything

#### Scenario: Missing module in the package
- **WHEN** the packaged runtime does not become healthy
- **THEN** it prints `PACKAGED RUNTIME FAILED TO START — this build is not shippable.`, names `Missing from the package: <module>` when the output contains `Cannot find module`, and exits 1

#### Scenario: Database location
- **WHEN** the runtime is healthy but `yodaman.db` is not in the temp data folder or is inside the bundle
- **THEN** it prints `PACKAGED RUNTIME WROTE ITS DATABASE INSIDE THE BUNDLE` (or `NOWHERE`) `: upgrades would erase it.` and exits 1

### Requirement: Protocol generation
`npm run generate:protocol` SHALL generate `shared/yodamanProtocol.js` and `shared/yodamanProtocol.d.ts` from `shared/protocol.schema.json`, each starting with the generated-file header, whose last sentence ends `public API for the clients that install the package. Keep them.` `tests/infrastructure/Protocol.test.js` SHALL fail when the committed files differ from the generator output.

#### Scenario: Generated content
- **WHEN** the generator runs
- **THEN** the JS file exports frozen `TASK_EVENT_TYPES`, `TASK_STATUSES` and `PLUGIN_PERMISSIONS` plus `isTaskEvent` and `assertTaskEvent`
- **AND** the `.d.ts` declares types `TaskEventType`, `TaskStatus`, `PluginPermission` and interfaces `YodaManTaskEvent` and `YodaManTask`
- **AND** `assertTaskEvent` throws `Unsupported YodaMan task event: <json>` for an unknown event

#### Scenario: Hand edit
- **WHEN** someone edits a generated file by hand
- **THEN** the Protocol test regenerates, restores the original and fails on the byte difference

### Requirement: Homebrew formula
`packaging/homebrew/yodaman.rb` SHALL install the published npm tarball with Node. `scripts/brew-formula.js` SHALL set its `url` and `sha256` from `https://registry.npmjs.org/yodaman/-/yodaman-<version>.tgz`, hashing the registry tarball, not a local build. `--check` SHALL exit 1 when the formula is stale.

#### Scenario: Regenerate after publish
- **WHEN** the version is published and the maintainer runs `node scripts/brew-formula.js`
- **THEN** it prints `Fetching <url>`, rewrites `url` and `sha256`, and prints `Updated <path>` with the version and hash
- **AND** prints `Formula already up to date; nothing written.` when nothing changed

#### Scenario: Not published yet
- **WHEN** the tarball cannot be fetched
- **THEN** it prints `Could not fetch the published tarball: <error>` and `If yodaman@<version> is not published yet, publish first, then run this.`
- **AND** exits 1 with `--check` and 2 without it

#### Scenario: Check mode
- **WHEN** the user runs `node scripts/brew-formula.js --check`
- **THEN** it prints `Formula matches yodaman@<version> (sha256 <first 12 chars>…)` and exits 0, or `Formula is out of date for yodaman@<version>.` and `Run: node scripts/brew-formula.js` and exits 1

#### Scenario: Formula behaviour
- **WHEN** Homebrew installs and tests the formula
- **THEN** it depends on `node`, runs `npm install` with `std_npm_args` and links `libexec/bin/*`
- **AND** the caveats tell the user to run `yodaman setup`, and `brew test` checks `yodaman --version`, that `yodaman --help` mentions `yodaman setup`, and that `bin/yodaman-mcp` exists

### Requirement: Docker image
The `Dockerfile` SHALL build the web app in a build stage and run `node server.js` in a slim runtime stage with `NODE_ENV=production`, `YODAMAN_PORT=3090` and port 3090 exposed, installing the Context Expert, OpenSpec and Graphify tools into the image. Its Node major MUST equal the one `engines.node` requires, and ctx and OpenSpec MUST install with the commands `DependencyChecker.js` gives setup (`tests/architecture/DockerfileMatchesRuntime.test.js`).

#### Scenario: Image contents
- **WHEN** the image is built
- **THEN** both stages use `node:24-bookworm-slim`, dependencies come from `npm ci`, and the build stage runs `npm run build`
- **AND** the runtime stage copies `node_modules`, `dist`, `backend`, `shared`, `public`, `plugins`, `server.js`, `start.js`, `package.json` and `config.example.json`, then copies `config.example.json` to `config.json`
- **AND** it installs `python3`, `python3-pip`, `npm install -g yodaman-ctx --allow-scripts=<the native packages DependencyChecker.js lists>`, `npm install -g @fission-ai/openspec@latest` and `pip install graphifyy`, but not Ollama
