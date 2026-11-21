# Graphify Knowledge Graph Specification

## Purpose
Graphify builds a knowledge graph of each workspace into `<workspace>/graphify-out/`. YodaMan runs the `graphify` CLI through `backend/infrastructure/GraphifyService.js`, serves it over the `/api/graphify/*` routes in `backend/interfaces/routes/graphifyRoutes.js`, and reads `graph.json` directly for structure facts (`backend/infrastructure/GraphFacts.js`), blast radius (`backend/infrastructure/ImpactAnalyzer.js`) and the `yodaman doctor --graph` report (`backend/infrastructure/GraphifyDoctor.js`). The `graphify` plugin (`plugins/graphify.js`) exposes the same service to the agent.

## Requirements

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

### Requirement: Building a graph
`build(path)` SHALL run `graphify update <path> --force`, or with `YODAMAN_GRAPHIFY_FULL_EXTRACT=true` run `graphify extract <path> --backend ollama --model <model> --out <path>`, where the model is `YODAMAN_GRAPHIFY_OLLAMA_MODEL` (default `qwen3:5b`). It MUST refuse a workspace folder that does not exist and MUST NOT create it.

#### Scenario: Missing workspace
- **WHEN** the workspace folder does not exist
- **THEN** build throws `Workspace folder not found: <path>` with `code` `workspace_missing` and status 404, and writes nothing

#### Scenario: Successful build
- **WHEN** Graphify exits 0 and `graph.html` exists
- **THEN** the build status is `succeeded` with message `Graphify graph built successfully`, and node and edge counts parsed from `Rebuilt: <n> nodes, <m> edges`
- **AND** the graph is then added to Graphify's global index with `graphify global add <graph.json> --as <folder name>`, logging `graphify_global_add_failed` on failure

#### Scenario: Visualization missing
- **WHEN** `graph.json` exists, `graph.html` is missing and the output says `outputs left untouched`
- **THEN** the system runs `graphify cluster-only <path>` once to regenerate it
- **AND** if `graph.html` is still missing the state is `partial` with message `Graphify graph built with skipped visualizations`, and a `Skipped graph.html: <reason>` line becomes the skipped reason

#### Scenario: Failed build
- **WHEN** Graphify fails
- **THEN** the status file records `state: "failed"` with the error message, start, end and duration, and the error is thrown on

### Requirement: Build status file
Each build SHALL record its state in `graphify-out/yodaman-build-status.json`: `running` at start, then `succeeded`, `partial` or `failed`, with `updatedAt`, `startedAt`, `completedAt`, `durationMs`, `output` (up to 4000 characters), `skippedArtifacts`, `nodeCount` and `edgeCount`. A status that cannot be read MUST read as `idle`.

#### Scenario: Unreadable status
- **WHEN** the status file is absent, a symlink or outside `graphify-out`
- **THEN** the status is `{ state: "idle" }`, and a file that fails to parse gives `{ state: "idle", message: "Build status could not be read" }`

#### Scenario: Orphaned running state
- **WHEN** the file says `running` and its `updatedAt` (or `startedAt`) is older than `YODAMAN_GRAPHIFY_RUNNING_STALE_MS`, default twice the Graphify timeout plus 60 seconds
- **THEN** the reported state is `succeeded` if the graph and an artifact exist, `partial` if only the graph exists, else `idle`, each with `staleRunning: true` and a message starting `Previous Graphify build status was stale`

#### Scenario: Graph without visualization
- **WHEN** the graph exists, no artifact exists, and the state is not `running` or `failed`
- **THEN** the reported state is `partial` with message `Graph built, but full HTML visualization is unavailable.` unless the stored message mentions `too large`

### Requirement: Graph status and freshness
`status(path)` SHALL report `available` (true only when the resolved binary is a file that can start; a bare `graphify` counts only when it is found on PATH), `binary`, `graphPath`, `reportPath`, `graphExists`, `reportExists`, `graphUpdatedAt`, `reportUpdatedAt`, `artifacts` and the reconciled `build`. `freshness(path)` SHALL add `latestSourceUpdatedAt` and `stale`, which is true when no graph exists or, when sources are scanned, a source file is newer than `graph.json`.

#### Scenario: Source scan
- **WHEN** sources are scanned
- **THEN** the walk skips ignored directories and symlinks, stops at depth 12, and its result is cached per workspace for 10 seconds

#### Scenario: No Graphify installed
- **WHEN** `YODAMAN_GRAPHIFY_BIN` names a file that does not exist, or the lookup falls back to a bare `graphify` that is not on PATH
- **THEN** `status(path).available` is `false`

#### Scenario: Status routes skip the scan
- **WHEN** a client calls `GET /api/graphify/status?path=<workspace>`
- **THEN** the response is `freshness(path, { scanSources: false })`, so `stale` is true only when no graph exists

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

### Requirement: Build jobs
`POST /api/graphify/build` with `{ path }` SHALL start a background build for an existing registered folder and answer 202 at once. One workspace MUST have at most one queued or running job. Jobs SHALL be kept in memory only, at most the 50 newest.

#### Scenario: Start
- **WHEN** no job is queued or running for the workspace
- **THEN** the response is 202 `{ message: "Graphify build queued", path, jobId, job, build }`, where `job` has `id`, `path`, `state`, `message`, `startedAt`, `completedAt`, `durationMs` and `error`
- **AND** the job moves through `queued`, `running`, then `succeeded`, `partial` or `failed`

#### Scenario: Already running
- **WHEN** a job is already queued or running for the workspace
- **THEN** that job is returned, and the message is `Graphify build already running` once it has left `queued`

#### Scenario: Poll
- **WHEN** a client calls `GET /api/graphify/build/status?path=<workspace>&jobId=<id>`
- **THEN** the response is `{ path, job, build, graph }`, using the newest job for the path when `jobId` is omitted
- **AND** an unknown `jobId`, or one for another path, gets 404 `Graphify build job not found: <id>` with `code` `graphify_build_job_missing`

### Requirement: Graph artifacts
`graphify-out/` SHALL hold `graph.json`, the `graph.html` visualization (artifact type `mindmap`), the report `graph_report.md` or `GRAPH_REPORT.md`, `yodaman-build-status.json`, `GRAPH_TREE.html` from the tree route, and `memory/` for saved answers. Artifact and report reads MUST refuse symlinks and files outside `graphify-out`.

#### Scenario: Serve the visualization
- **WHEN** a client calls `GET /api/graphify/artifact?path=<workspace>&type=mindmap`
- **THEN** the HTML is returned with `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer` and a `Content-Security-Policy` with `script-src 'self' 'unsafe-inline'`
- **AND** the unpkg `vis-network` script is rewritten to `/vendor/vis-network.min.js` with its `integrity` and `crossorigin` attributes removed, and `Community <n>` labels become `<most common file name> cluster`

#### Scenario: Unknown or missing artifact
- **WHEN** `type` is not `mindmap`
- **THEN** the response is 400 `Unknown Graphify artifact type: <type>` with `code` `invalid_graphify_artifact`
- **AND** a missing artifact gets 404 `Graphify artifact not found: <file>` with `code` `graphify_artifact_missing`

#### Scenario: Report
- **WHEN** a client calls `GET /api/graphify/report?path=<workspace>`
- **THEN** the response is `{ path, report, reportPath }` with the report cut to 120000 characters plus a truncation note
- **AND** no report gets 404 `Graphify report not found: <reportPath>` with `code` `graphify_report_missing`

### Requirement: Graph map preview
`GET /api/graphify/map?path=<workspace>&limit=<n>&rank=<order|degree>` SHALL return a bounded, read-only view of the graph. It MUST NOT build or write anything, and MUST leave out nodes whose source file no longer exists and their links.

#### Scenario: Shape
- **WHEN** the map is requested
- **THEN** the response is `{ graphPath, totalNodes, totalLinks, missingFileNodes, communities, nodes, links }`
- **AND** nodes have `id`, `label`, `community`, `fileType`, `sourceFile` and `sourceLocation`, and links have `source`, `target`, `relation`, `confidence`, `sourceFile` and `sourceLocation`

#### Scenario: Limits
- **WHEN** `limit` is omitted or not a positive number
- **THEN** 80 nodes are used, any limit is capped at 10000, and links are capped at twice the limit (six times with `rank=degree`)
- **AND** `rank=degree` picks the most connected nodes first with ties in file order, and any other value uses file order

#### Scenario: No graph
- **WHEN** `graph.json` does not exist
- **THEN** the response is 500 `Graphify graph not found: <graphPath>` with `code` `graphify_map_failed`

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

### Requirement: Dependency edges
Structure facts SHALL follow only dependency relations: `imports_from`, `imports`, `import`, `calls`, `call`, `requires`, `require`, `extends`, `implements`, `uses`, `references`, `depends_on` and `inherits`, matched case-insensitively. Containment edges (`contains`, `method`, `defines`) and self-links MUST be ignored. Graph ranking, GraphFacts and ImpactAnalyzer SHALL share this set.

#### Scenario: Test files
- **WHEN** a path is under `test/`, `tests/` or `__tests__/`, ends in `.test.<js|ts|...>` or `.spec.<js|ts|...>`, ends in `_test.py`, or is a `test_*.py` file
- **THEN** `isTestFile` returns true

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

### Requirement: Graph doctor
`yodaman doctor --graph` SHALL report Graphify health for every workspace in `config.json` and exit 1 when no workspace has a graph, else 0. A failure SHALL print `Graphify health check failed: <message>` and exit 1.

#### Scenario: Report lines
- **WHEN** the doctor runs
- **THEN** it prints `✓ Graphify active for <n> project` (or `projects`) and `✓ Knowledge graph freshness: <percent>% (last build <relative time or never>)`
- **AND** a project whose build state is `failed` or `running`, or whose graph is older than any source file (`freshness(path).stale`), does not count as fresh

#### Scenario: Orphaned nodes and tip
- **WHEN** a graph with more than one node has nodes with no links
- **THEN** it prints `⚠️ Project "<name>" has <n> orphaned node` (or `nodes`) ` (run Sync Repository or POST /api/reindex)`, else `✓ No orphaned graph nodes detected`
- **AND** it ends with `💡 Tip: Most complex file is "<file>" (<n> dependencies)` when any graph has nodes, naming the file with the most links

### Requirement: Graphify agent plugin
The `graphify` plugin SHALL accept `action` `query`, `explain`, `path`, `affected`, `status` or `build`, with the workspace in `path` or `workspacePath` (default the server's working folder). With no action it SHALL run `query` when `query` is given, else `status`. Missing inputs MUST throw.

#### Scenario: Build from the agent
- **WHEN** the plugin runs with `action: "build"`
- **THEN** it calls `build(path, { update: true })` and returns its result

#### Scenario: Missing input
- **WHEN** `action` is `explain` or `affected` without `node`, `path` without `source` and `target`, or `query` without `query`
- **THEN** it throws `node is required for graphify explain`, `node is required for graphify affected`, `source and target are required for graphify path` or `query is required for graphify query`
