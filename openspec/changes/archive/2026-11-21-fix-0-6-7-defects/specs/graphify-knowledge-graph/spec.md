## MODIFIED Requirements

### Requirement: Graphify binary resolution
The system SHALL find the `graphify` binary in this order: `YODAMAN_GRAPHIFY_BIN`, `dependencyChecker.which('graphify')`, the newest runnable `~/Library/Python/<version>/bin/graphify`, then bare `graphify`. A cached absolute path that can no longer start MUST be resolved again, unless `YODAMAN_GRAPHIFY_BIN` is set.

#### Scenario: Override
- **WHEN** `YODAMAN_GRAPHIFY_BIN` is set
- **THEN** that value is used for every Graphify call

#### Scenario: Interpreter removed
- **WHEN** the cached launcher's Python was removed
- **THEN** the next call searches again instead of failing until a restart

#### Scenario: Availability check
- **WHEN** `assertAvailable()` runs `graphify --help` and it fails within 10 seconds
- **THEN** it throws `Graphify is required but "<binary>" is not available. Install it with "pip install graphifyy" and ensure the "graphify" command is in PATH, or set YODAMAN_GRAPHIFY_BIN.`
- **AND** it then checks Ollama, which is optional, and logs `ollama_not_running` or `ollama_unavailable` without failing

### Requirement: Local-only Graphify runs
Every Graphify call SHALL run with `execFile`, never a shell, and MUST remove `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY` and `MOONSHOT_API_KEY` from its environment. It SHALL set `GRAPHIFY_VIZ_NODE_LIMIT` to `YODAMAN_GRAPHIFY_VIZ_NODE_LIMIT` (default 25000) when not already set.

#### Scenario: Limits
- **WHEN** a Graphify command runs
- **THEN** its timeout is `YODAMAN_GRAPHIFY_TIMEOUT_MS` (default 300000 ms) and its output buffer is 5 MB

#### Scenario: Timeout
- **WHEN** the process is killed by the timeout
- **THEN** the error has `code` `graphify_timeout` and reads `Graphify was stopped after <seconds>s (signal <signal>). Large workspaces can need longer: raise YODAMAN_GRAPHIFY_TIMEOUT_MS, or narrow the workspace to the directories you actually want in the graph.`

#### Scenario: Other failure
- **WHEN** Graphify exits with an error
- **THEN** the error message is its trimmed stderr, else its stdout, else the process error message

### Requirement: Registered workspaces only
Every `/api/graphify/*` route SHALL resolve its `path` (query for GET, body for POST) and MUST refuse a path that is not in `watchedDirectories`. Errors SHALL be JSON `{ error, code }` with the error's status, or 500 and a route-specific code.

#### Scenario: Unregistered path
- **WHEN** a client calls any Graphify route with a path that is not registered
- **THEN** the response is 404 with `Workspace is not registered: <path>` and `code` `workspace_not_registered`

#### Scenario: Missing path
- **WHEN** `path` is missing or empty
- **THEN** the response is 400 with `path must be a non-empty string`

#### Scenario: Default error codes
- **WHEN** a route fails without its own code
- **THEN** the codes are `graphify_build_failed`, `graphify_build_status_failed`, `graphify_artifact_failed`, `graphify_report_failed`, `graphify_query_failed`, `graphify_explain_failed`, `graphify_path_failed`, `graphify_affected_failed`, `graphify_map_failed` and `graphify_tree_failed`

### Requirement: Graph questions
`POST /api/graphify/query`, `/explain`, `/path`, `/affected` and `/tree` SHALL run the matching Graphify command against `graphify-out/graph.json` and return its text, cut to 6000 characters with the note `[Graphify output truncated to 6000 characters]`. Each SHALL build a graph first only when none exists; a stale graph MUST be used as is.

#### Scenario: Query and explain
- **WHEN** a client posts `{ path, query }` to `/api/graphify/query`
- **THEN** the system runs `graphify query <query> --graph <graph.json>` and answers `{ path, insights, graphPath }`
- **AND** `/explain` with `{ path, node }` runs `graphify explain <node>` and answers `{ path, node, explanation, graphPath }`

#### Scenario: Path and affected
- **WHEN** a client posts `{ path, source, target }` to `/api/graphify/path`
- **THEN** it runs `graphify path <source> <target>` and answers `{ path, source, target, graphPath, result }`
- **AND** `/affected` with `{ path, node, depth?, relations? }` runs `graphify affected <node> --depth <depth> --graph <graph.json>` plus one `--relation` per entry, depth defaulting to 2, and answers `{ path, node, depth, relations, graphPath, impact }`

#### Scenario: Tree
- **WHEN** a client posts `{ path }` to `/api/graphify/tree`
- **THEN** it runs `graphify tree --graph <graph.json> --output <path>/graphify-out/GRAPH_TREE.html --label <folder name>` and answers `{ output, message }`

#### Scenario: Input limits
- **WHEN** `query` exceeds 20000 characters, `node`, `source` or `target` exceeds 1000, or a relation exceeds 100
- **THEN** the response is 400 with `<name> must be <max> characters or fewer`

#### Scenario: Values that could be read as flags
- **WHEN** `node`, `source`, `target` or a relation starts with `-`, through the routes, the agent's tools or the plugin
- **THEN** GraphifyService refuses it before Graphify runs, and the route answers 400 with `<name> must not start with "-"` and `code` `graphify_invalid_argument`
- **AND** leading dashes and spaces are dropped from a `query`, which is prose, and an empty result is 400 `query must be a non-empty string`
- **AND** `save-result` passes `--question=<text>`, `--answer=<text>`, `--type=<type>` and `--memory-dir=<dir>`, so an answer that starts with `-` is kept as the value

#### Scenario: Affected depth
- **WHEN** `/affected` gets a `depth` that is not a whole number from 1 to 6 (for example `"abc"` or `0`)
- **THEN** the response is 400 with `depth must be a whole number from 1 to 6` and `code` `graphify_invalid_argument`, and Graphify does not run

### Requirement: Blast radius
`ImpactAnalyzer.analyzeFile(project, file, { depth })` SHALL walk incoming dependency edges from every node of the file, up to `depth` hops (default 2), and report the dependent files. It MUST NOT throw: a missing graph or unknown file SHALL return `available: false` with a reason.

#### Scenario: Report
- **WHEN** the file is in the graph
- **THEN** the report has `available: true`, `stale`, `targetFile`, `depth`, `matchedNodes`, `dependentFiles` (each `{ file, hops, isTest }`), `impactedCount`, `testCount`, `coveringTests`, up to 5 `topDependents` and `risk`

#### Scenario: Risk
- **WHEN** risk is assessed
- **THEN** it is `low` with no impacted files, `high` with 5 or more impacted files and no tests, `moderate` with fewer and no tests, `moderate` with tests and 12 or more impacted files, otherwise `low`

#### Scenario: Unavailable
- **WHEN** no graph exists
- **THEN** the reason is `no graph has been built for this workspace yet`
- **AND** a file with no nodes gives `file is not in the graph yet — the graph is stale` or `file is not represented in the graph`

### Requirement: Workspace structure facts
`GraphFacts` SHALL read the graph once into file-level `dependsOn`, `dependedOnBy` and `degree` maps and answer `orphanFiles`, `coverageByFile` and `centralFiles`. With no usable graph each MUST return null and log `graph_facts_unavailable`.

#### Scenario: Orphans
- **WHEN** `orphanFiles` runs
- **THEN** it lists files nothing imports, skipping entry points (such as `server.js`, `bin/`, `scripts/`, `plugins/`, `electron/main.js`, tool configs and `.d.ts` files) and, unless `includeTests`, test files
- **AND** results are sorted by import count descending, then path

#### Scenario: Test coverage and hubs
- **WHEN** `coverageByFile` runs with the default depth 2
- **THEN** each non-test file maps to the test files that reach it within 2 forward hops
- **AND** `centralFiles` returns up to 25 `{ file, connections, dependents }`, most connected first
