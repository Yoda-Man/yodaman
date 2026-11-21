# Search Pipeline Specification

## Purpose
Every search in YodaMan runs one pipeline: Context Expert (ctx) retrieves, a hygiene step drops duplicates, generated files and missing files, Graphify ranks, and OpenSpec tags each hit. The pipeline is `search()` in `backend/core/SearchPipeline.js`, served over HTTP by `backend/services/searchRouter.js` at `/api/search`. This capability also covers how ctx is invoked (`backend/infrastructure/ContextEngine.js`, `backend/infrastructure/CliOutput.js`, `ToolBox.contextExpertSearch`), the ranking blend (`backend/infrastructure/GraphRanker.js`), hit helpers (`shared/searchHits.js`), the local-model summary (`backend/core/SearchSummary.js`) and `POST /api/ask`.

## Requirements

### Requirement: One pipeline for every search
Every search SHALL go through `SearchPipeline.search()`, which runs in order: ctx retrieval, hygiene, Graphify ranking, OpenSpec tagging. Callers MAY choose the mode (`unified`, `code`, `doc`) but MUST NOT skip a stage. Raw ctx retrieval, `ctx search`, `GraphRanker.rerank` and setting `specFlag` SHALL appear nowhere else, as `tests/architecture/SearchPipelineBoundary.test.js` enforces.

#### Scenario: Entry points
- **WHEN** a search runs from `/api/search`, `/api/search/code`, `/api/search/docs`, `/api/search/stream`, the agent's `searchCode` tool and direct chat search, the Stardust routes and spec baseline, or `/api/ask`
- **THEN** each calls `SearchPipeline.search()`
- **AND** the MCP server and the VS Code extension reach it through `GET /api/search`

#### Scenario: Unknown mode
- **WHEN** `search()` is called with a mode other than `unified`, `code` or `doc`
- **THEN** it throws `Unknown search mode: <mode>`

#### Scenario: Read only
- **WHEN** a search runs
- **THEN** it writes nothing into the workspace

### Requirement: Search routes
`GET /api/search`, `/api/search/code` and `/api/search/docs` SHALL take query parameters `query`, `project`, `top` and `activeFile` and return the pipeline result as JSON. A missing `query` MUST get 400 `{ error: "Query is required", code: "query_required" }`.

#### Scenario: Unified search
- **WHEN** a client calls `GET /api/search?query=auth&project=/w/app`
- **THEN** the pipeline runs in `unified` mode with `top` defaulting to 15
- **AND** the body is `{ results, graphRanked, weights, activeFile, pillars, dropped }` with no `mode` field

#### Scenario: Code and docs
- **WHEN** a client calls `/api/search/code` or `/api/search/docs`
- **THEN** the mode is `code` or `doc`, `top` defaults to 10, and the body adds `mode: "code"` or `mode: "doc"`

#### Scenario: Failure
- **WHEN** the pipeline throws
- **THEN** `search_failed` is logged and the response uses the error's `status` or 500 with `{ error, code, requestId }`, where `code` defaults to `search_failed`

### Requirement: Streaming search with summary
`GET /api/search/stream` SHALL send Server-Sent Events: `results` with the unified pipeline output as soon as it exists, then a local-model summary of those same results. The results MUST NOT wait for the model, and closing the connection SHALL abort the model request.

#### Scenario: Normal stream
- **WHEN** the search returns at least one hit
- **THEN** the events are `results`, `summary_start` with `{ model }`, one or more `summary` with `{ text }`, then `done` with `{}`
- **AND** the headers are `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `Connection: keep-alive`

#### Scenario: No hits
- **WHEN** the search returns no hits
- **THEN** only `results` and `done` are sent

#### Scenario: Search or summary fails
- **WHEN** the pipeline throws
- **THEN** a `search_error` event `{ error, code, requestId }` is sent and the stream ends
- **AND** when only the summary fails, `summary_error` with `{ error }` is sent, `search_summary_failed` is logged as a warning, and `done` follows

### Requirement: Workspace resolution
`project` SHALL accept an absolute path or a registered workspace's folder name. A name SHALL resolve to the first watched directory with that path or basename, else stay as given. A workspace given as an absolute path whose folder is gone MUST fail with 404 before ctx is called.

#### Scenario: By name
- **WHEN** `project=Anchor` and `/w/Anchor` is registered
- **THEN** the search is scoped to `/w/Anchor`

#### Scenario: Folder gone
- **WHEN** `project` is an absolute path that does not exist
- **THEN** the error is `Workspace folder not found: <path>. It may have been moved or deleted: edit its path in Settings, or remove it there.` with status 404 and `code` `workspace_missing`

#### Scenario: Outside allowed roots
- **WHEN** `project` resolves outside the server's working folder and every watched directory
- **THEN** retrieval throws `Path is outside allowed workspaces: <path>` and the route answers 500 with `code` `search_failed`

### Requirement: Context Expert retrieval
Stage 1 SHALL make exactly one `ctx search ... --json -- <query>` call per search, scoped with `-p <index name>` when a workspace is given and `-k <top>` clamped to 1..50. `top` SHALL be normalised to a whole number from 1 to 50, defaulting to 10 when not a positive number. In `doc` mode only hits whose path ends in `.md`, `.markdown`, `.rst`, `.txt` or `.adoc` SHALL be kept.

#### Scenario: Hit shape
- **WHEN** ctx returns hits as `{ score, filePath, lineStart, content, ... }`
- **THEN** each hit keeps its fields and gains `content`, `text`, `snippet`, a numeric `score` and `metadata` with `path`, `line`, `lineEnd`, `language` and `source` (`ctx-semantic` unless ctx set one)
- **AND** each hit is tagged `_source: "docs"` or `"code"` by its file extension

#### Scenario: Workspace not indexed
- **WHEN** ctx's project list has no index for the workspace or any ancestor
- **THEN** `ctx_project_not_indexed` is logged and a literal filesystem scan of that folder replaces ctx

#### Scenario: Fallback scan
- **WHEN** ctx returns no hits, an error object, an unknown shape, or fails
- **THEN** the system scans the workspace (the server's working folder when none is given) for a case-insensitive substring, skipping ignored directories, `.env` files, files over 1 MB and binary files, to depth 8 and at most `top` hits
- **AND** each fallback hit has `metadata.source` `filesystem-fallback`, an absolute path, a 5-line snippet and a score of 0.65 (0.8 when the file name contains the query)

### Requirement: Hit hygiene
Between retrieval and ranking the pipeline SHALL remove duplicate hits, hits in generated folders, and hits whose file no longer exists. The counts MUST be reported in `dropped`.

#### Scenario: Duplicates
- **WHEN** two hits share a path and start line, or share a path, have no line and have the same first 80 characters of text
- **THEN** only the first is kept, and hits with no path are dropped
- **AND** `dropped.duplicates` counts them

#### Scenario: Generated output
- **WHEN** a hit's path contains a `graphify-out/`, `.yodaman/`, `.yodaman-doc-chunks/`, `node_modules/`, `dist/` or `release/` segment
- **THEN** it is dropped and counted in `dropped.generated`

#### Scenario: Missing file
- **WHEN** a hit names a file that is not on disk in the workspace
- **THEN** it is dropped, counted in `dropped.missing`, and `search_hits_dropped` is logged

### Requirement: Graphify ranking
Stage 2 SHALL re-order hits by the blend semantic 0.50, proximity 0.20, centrality 0.15 and spec coverage 0.15, using only dependency edges of `graphify-out/graph.json`. Ranking MUST be advisory: it never drops hits, and with no graph, fewer than 2 hits, no workspace, or no hit in the graph it SHALL return the input order.

#### Scenario: Signals
- **WHEN** hits are ranked
- **THEN** semantic is the score scaled to 0..1 across the hits (0.5 when all are equal), centrality is the file's dependency degree over the highest degree, and spec coverage is 1 when an OpenSpec spec cites the file
- **AND** proximity is `1 - hops/3` from `activeFile` over undirected dependency edges, and 0 beyond 3 hops or with no active file

#### Scenario: Ranked hits
- **WHEN** at least one hit's file is in the graph
- **THEN** hits are sorted by blended score, ties keeping input order, and each gets `graphRank` (4 decimals) and `graphSignal` with `semantic`, `centrality`, `proximity`, `specCoverage`, `hops`, `inGraph` and `weights`

#### Scenario: Graph cache
- **WHEN** the same workspace is searched again and `graph.json` has the same mtime
- **THEN** the parsed graph index is reused without reading the file

#### Scenario: Graph unreadable
- **WHEN** `graph.json` exists but cannot be parsed
- **THEN** `graph_ranking_unavailable` is logged at high severity with the file size, and the input order is returned

### Requirement: OpenSpec tagging
Stage 3 SHALL read every `.md` file under the workspace's `openspec/specs/` and mark each hit with the specs whose text cites its file. Tagging MUST be advisory: a workspace without specs keeps its hits untagged.

#### Scenario: Covered hit
- **WHEN** a spec cites `backend/core/SearchPipeline.js` and a hit has that path, or that file name
- **THEN** the hit gets `specFlag: { covered: true, specs: [<spec ids>] }` with at most 3 ids, each the spec's path relative to `openspec/specs/`

#### Scenario: Uncovered hit
- **WHEN** specs exist but none cites the hit's file
- **THEN** the hit gets `specFlag: { covered: false }`

#### Scenario: No specs
- **WHEN** the workspace has no `openspec/specs/` or no spec files
- **THEN** hits get no `specFlag` and `pillars.openspec` is false

### Requirement: Honest pillar report
Every search result SHALL report which stages actually contributed in `pillars` and the ranking weights in `weights`. A degraded search MUST NOT look like a full one.

#### Scenario: Pillars
- **WHEN** a search returns
- **THEN** `pillars.contextExpert` is false only when every hit came from the filesystem fallback, `pillars.graphify` is true only when some hit has a `graphSignal`, and `pillars.openspec` is true when specs were found
- **AND** `graphRanked` equals `pillars.graphify`, `weights` is the default blend, and `activeFile` is the given file or null

#### Scenario: Graph ranked nothing
- **WHEN** a workspace search kept at least 2 hits and none was graph ranked
- **THEN** `search_graph_ranking_inactive` is logged with a hint that no graph exists or ctx and Graphify were indexed from different roots

### Requirement: Search summary uses the local model only
The summary SHALL be written by the Ollama model ctx is configured with, read once from `ctx status --json`, and MUST use only the pipeline's hits. If ctx's `llm.provider` is not `ollama` or names no model, the summary SHALL fail with `Context Expert is not set up with a local Ollama model (found <provider or none>).`

#### Scenario: Prompt
- **WHEN** a summary is requested
- **THEN** the system posts to `http://127.0.0.1:11434/api/chat` with `stream: true`, `think: false` and `temperature` 0.2
- **AND** the prompt holds the query and at most 8 hits as `[n] <path>:<line>`, their spec ids when covered, and up to 700 characters of text each

#### Scenario: Cache
- **WHEN** the same model and prompt were summarised to completion before
- **THEN** the stored text is returned without calling the model, and at most 50 summaries are kept, oldest dropped first

#### Scenario: Model error
- **WHEN** Ollama answers a non-OK status or streams an `error`
- **THEN** the summary fails with `Local model <model> answered <status>: <body>` or that error, and a cut-off summary is never cached

### Requirement: Invoking the ctx CLI
All ctx calls SHALL spawn the binary found by `dependencyChecker.which('ctx')`, looked up on every call, else `ctx`. Calls with `--json` MUST be parsed from the first line starting with `{` or `[` to the last `}` or `]`. Running ctx processes SHALL be stopped with SIGTERM on shutdown.

#### Scenario: JSON flag before free text
- **WHEN** `executeJson(['search', '-p', 'x', '--', '-q'])` is called
- **THEN** ctx is spawned with `search -p x --json -- -q`, so ctx never reads `--json` as query text

#### Scenario: Exit codes
- **WHEN** ctx exits 0, or exits non-zero with `--json` in its arguments and some stdout
- **THEN** the call resolves with `{ output, code }`
- **AND** otherwise it rejects with stderr, or `CLI command failed with code <code>`, carrying `partialOutput` and `exitCode`

#### Scenario: Timeout and spawn failure
- **WHEN** a `timeoutMs` is given and passes
- **THEN** the process gets SIGTERM and the call rejects with `<binary> command timed out after <ms>ms`
- **AND** a spawn error rejects with `Failed to start <binary>: <message>`; calls without `timeoutMs` have no timeout

#### Scenario: Bad JSON
- **WHEN** `--json` output holds no JSON block
- **THEN** `ctx_json_parse_failed` is logged and the call rejects with `Failed to parse CLI JSON: No valid JSON block found in CLI output`

### Requirement: Project names for ctx
`-p` SHALL be given ctx's index name, never a path. The name SHALL come from `ctx list --json`, cached for 60 seconds and dropped after an index or removal. A path not listed SHALL use its closest indexed ancestor; it MUST NOT fall back to the folder name unless `ctx list` itself failed.

#### Scenario: Exact match
- **WHEN** ctx lists `/w/app` as `app-1a2b3c`
- **THEN** `projectName("/w/app")` returns `app-1a2b3c`

#### Scenario: Nested folder
- **WHEN** `/w/app/pkg` is not listed but `/w/app` is
- **THEN** the name of `/w/app` is returned, unless `exact` is set, which returns null

#### Scenario: List unavailable
- **WHEN** `ctx list` fails
- **THEN** `ctx_list_failed` is logged and the folder's basename is returned

### Requirement: Ask route
`POST /api/ask` with `{ question, projectId? }` SHALL take `projectId` only as a registered workspace, by path or folder name, add the workspace's Graphify context and search pipeline hits to the prompt, and ask through `ContextEngine.ask` with a timeout of `YODAMAN_CTX_ASK_TIMEOUT_MS` (default 12000 ms), strip CLI noise and return `{ answer }`. When ctx fails, the answer MUST be built from the same hits.

#### Scenario: Graph context
- **WHEN** `projectId` names a workspace
- **THEN** the prompt holds the Graphify report (up to 4000 characters, without its `## Community Hubs (Navigation)` section) and `graphify query` output for the question
- **AND** it holds the search pipeline's top 5 hits, ranked by Graphify and tagged with their OpenSpec specs
- **AND** ctx is called as `ctx ask -p <index name> -- <prompt>`, refused over the prompt limit
- **AND** the question and answer are saved to the session and to `graphify-out/memory` with `graphify save-result`

#### Scenario: Fallback
- **WHEN** `ctx ask` fails or times out
- **THEN** `ask_ctx_fallback_started` is logged and the answer starts `YodaMan could not reach ctx ask (<error>), so it answered from local workspace context instead.`, followed by the graph context and numbered pipeline hits

#### Scenario: Errors
- **WHEN** `question` is missing, empty or over 20000 characters
- **THEN** the response is 400 with `code` `invalid_request`
- **AND** a question with no letter or digit (such as `---`) gets 400 `question must contain a letter or digit` with `code` `invalid_question`
- **AND** a `projectId` that is not a registered workspace gets 404 `workspace_not_registered`, and nothing is written into that folder
- **AND** any other failure is 500 `{ error, code: "ask_failed", requestId }` and is logged as `ask_failed`

### Requirement: CLI output cleanup
Prose from ctx SHALL be cleaned by `stripCliNoise`, which removes banner glyph lines and lines starting `injected env`, `tip:`, or reading `Searching ...`, `Indexing ...` or `Loading ...`, and drops leading blank lines. It MUST keep citation lines, and MUST return the trimmed original when cleaning would leave nothing.

#### Scenario: Banner removed
- **WHEN** output starts with `◇ injected env (2)` then the answer
- **THEN** only the answer remains

#### Scenario: Error line
- **WHEN** `summarizeCliError` reads stderr that begins with a `DeprecationWarning`
- **THEN** it skips warning lines and returns the first line starting `Error`, `error`, `FATAL` or `Failed`, else the first naming an error, else `the CLI exited without a diagnostic`

#### Scenario: Citations only
- **WHEN** `hasSubstantiveAnswer` reads output that is only a `Sources:` block of `[n] path (score)` lines
- **THEN** it returns false

### Requirement: Shared hit helpers
Every consumer SHALL read hits through `shared/searchHits.js`, an ES module with no dependencies that the backend and the Vite frontend both import. `hitPath` MUST read `metadata.path`, then `filePath`, `path`, `file`.

#### Scenario: Reading a hit
- **WHEN** a hit is `{ filePath: "a/b.js", lineStart: 4, content: "x" }`
- **THEN** `hitPath` is `a/b.js`, `hitLine` is 4 and `hitText` is `x`, and `hitLine` is null for a missing or non-positive line

#### Scenario: Chat file reference
- **WHEN** `chipPath("README.md")` is called
- **THEN** it returns `./README.md`, while paths with a directory part or a drive letter are returned with forward slashes and no prefix
