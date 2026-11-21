## MODIFIED Requirements

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
