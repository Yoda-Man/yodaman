# Changelog

All notable changes to **YodaMan** will be documented in this file.

## [0.5.2] - 2026-08-20

### Fixed — Graph Studio drew nothing

Reported from a running 0.5.1 desktop app: the Graph tab showed an empty canvas
while the panel beside it read "Graph ready — 2804 nodes / 3151 links" and
listed every top node correctly. The data was never the problem. Nothing could
draw it.

Graphify emits its rendering library as a CDN tag carrying a subresource-
integrity hash:

    <script src="https://unpkg.com/vis-network@9.1.6/..."
            integrity="sha384-Ux6phic9PEHJ38..." crossorigin="anonymous">

YodaMan rewrites that `src` to a vendored copy so the app works offline and no
part of your codebase is described to a CDN on page load. It left the
`integrity` attribute in place — and the vendored copy is a different build,
because vis-network was upgraded from 9.x to 10.1.1 to clear a vulnerability.
The hashes could not match by construction. The browser did exactly as
instructed and blocked the script, `vis` was never defined, and the canvas
stayed empty.

Two correct changes combined into a broken one. The localiser now drops
`integrity` and `crossorigin` when it repoints a script at a same-origin file we
ship and audit ourselves: SRI defends against a CDN serving something other than
what was asked for, and a hash that can never match is not security, it is an
outage.

### Added — a gate that fails when the graph cannot be drawn

Everything already in the pipeline passed while this shipped. The endpoint
returned 200 with 2.1MB of correct HTML, and no test asked whether a browser
could run it.

`tests/electron/GraphRenderSmoke.test.js` drives a real Electron window, passes
a realistic Graphify fixture through the REAL localiser, and asserts the library
executed and produced a canvas. Verified by mutation: with the stale hash
restored it fails and reports the browser's own reason — "The resource has been
blocked" and "vis is not defined" — rather than a bare assertion failure.

It runs in `npm test`, and `npm run test:render` now covers it too, so a build
cannot be packaged without it.

### Changed

- vis-network 10.1.1 -> 10.1.2, verified by the new render gate rather than
  assumed. Vendored copy audits clean.

## [0.5.1] - 2026-08-20

### Fixed — 9B was the floor, but the code treated it as the ceiling

YodaMan is built to run on a 9B model and to get better when given a larger one.
It did not. The agent compacted hard for small context windows, and every other
case fell through to a flat 9,000-character prompt budget, so a 32B model served
at 131,072 tokens sent exactly the same prompt as a 9B served at 8,192 — about
2% of the window, with the rest unused. Running a bigger model bought nothing.

The budget now scales with the window Ollama is actually serving:

| Served window | Before | After |
|---|---|---|
| unset / 4096 | 9,000 chars | 9,000 chars |
| 32,768 | 9,000 chars | 40,140 chars |
| 131,072 | 9,000 chars | 120,000 chars |

Per-tool-result clipping scales with it too, so a large window keeps a whole file
verbatim instead of cutting it at 6,000 characters mid-function.

Two deliberate conservatisms. Only the **configured** window is trusted, never
the model's declared maximum: Ollama serves what `OLLAMA_CONTEXT_LENGTH` says or
picks by VRAM when unset, and sizing a prompt against the declared figure is how
prompts overflowed in 0.4.6 — llama-server drops from the *front*, silently
removing the tool instructions. And every floor is the value used before, so no
configuration gets a smaller budget than it had.

Also fixed: `detectOllamaContext` probed a hardcoded `qwen3.5:9b` and cached one
answer for every model, so anyone running something larger was told their model's
capability was 9B's. It now probes the configured model and caches per model.

### Fixed — ranking silently fell back with no way to tell

`GraphRanker.buildIndex` discarded every error, so a graph that existed but could
not be parsed was indistinguishable from a workspace with no graph. Search
dropped to semantic-only ordering while `/api/search` went on advertising all
four weights. A graph that fails to load now logs at severity high with its size;
a workspace with no graph stays quiet. Control flow is unchanged.

### Fixed — gates that tested the wrong build

The journey and approval gates adopted whatever was already listening on port
3090. With the desktop app open, they measured *that* build instead of the
working tree and reported it as though they had tested your changes. They now run
on their own port from the working tree and state which runtime produced the
result.

The ranking gate also derived its search term from the highest-degree file in the
graph without checking ctx had indexed it. Graphify walks vendored trees ctx
excludes, so the term came from `third_party` and node_modules code that search
legitimately never returns — the gate was measuring index overlap, not the
ranking blend. It now tries several graph-connected terms and fails only when
none rank. Verified by mutation: with the blend forced off it exits 1 on all
eight candidates; restored, it exits 0.

`DesktopRenderSmoke` escalated to SIGKILL after 5s while inheriting Jest's 5s
default hook timeout, so the escalation fired exactly as the hook was abandoned.
A runtime slow to exit under load failed the suite after every test in it had
passed.

### Changed

- The README now pairs model size with the context window to set, and documents
  the VRAM trade-off: context is charged whether or not a request uses it, and a
  22B model at 32,768 beats a 32B model that is swapping. Its figures are tested
  against the code that produces them rather than trusted.
- `GraphifyService` and `ToolBox` now read the shared ignored-paths list, which
  was still duplicated in both. The Graphify copy mattered beyond speed: scanning
  `.yodaman-doc-chunks` meant a newer generated chunk read as "the source
  changed", so the graph could look stale on work nothing did to the source.
- Removed the six design plans under `docs/superpowers`. The project is past its
  planning phase, and their exemption from the documentation accuracy checks went
  with them — every remaining document is now held to the standard.
- Corrected the OpenSpec version in the api.md sample response, which read 0.5.0
  while OpenSpec is 1.5.0 and collided with YodaMan's own version number.

## [0.5.0] - 2026-08-19

### Fixed — a file-descriptor leak that silently disabled every tool

The watcher and the indexer each kept their own list of directories to skip, the
two drifted, and neither listed `.yodaman-doc-chunks` — a directory YodaMan
generates itself. chokidar 4 dropped the fsevents backend, so on macOS it holds
one descriptor per watched path; watching our own output meant a runtime four
minutes old held **10,307 open descriptors, 5,264 of them chunk files**.

A process that fills its descriptor table cannot allocate pipes, so `spawn`
begins failing with `EBADF`. The symptom appears nowhere near the cause: the
agent stops being able to run ctx, graphify, or any plugin, and a desktop app
left open long enough simply stops working. This is what made the approval gate
report INCONCLUSIVE — the agent could not reach the writeFile tool to propose
anything.

There is now one shared list (`shared/ignoredPaths.js`) covering generated
output, build caches, and vendored trees, read by both the watcher and the
indexer. Held descriptors dropped from **10,307 to 3,572**, and the approval
gate now passes against a real workspace: the write pauses, and rejecting it
leaves the file untouched.

`bin`, `packages`, and `target` are deliberately *not* ignored. Each is build
output in one ecosystem and hand-written source in another, and silently
refusing to index someone's source is a worse failure than watching some output.
A test asserts they stay off the list, and another asserts both consumers read
the shared one so the copies cannot drift again.

The verification story, finished. Three days ago this project had never had a
green CI run and shipped an agent that could not call a tool; it now proves the
artifact starts, the safety gate holds, and the docs describe what exists.

### Added — tests for the modules that had none

The audit listed six untested modules. Size was not the risk:

- **OllamaConfig** writes a launchd plist and restarts a system service, and I
  wrote it in 0.4.7 without tests. 13 now cover the guarantees that make it safe
  to expose from a web UI: only values on a fixed list are accepted, the plist
  edit produces balanced XML, an existing value is replaced rather than
  duplicated, and an unrelated variable in the same block survives.
- **stardustRoutes** is 614 lines and holds the H-1 path-traversal fix.
  `proposeChange` builds a directory from a caller-supplied name, so the guard
  against separators and `..` now has a regression test — including an assertion
  that nothing was written outside the workspace.
- **PluginAPI, DefaultCodingSkill, StardustWrapper, gitRoutes,
  SettingsProvider** — covered, including that every security default is the
  safe value, since those defaults are the posture of an unconfigured install.

`DefaultCodingSkill` is asserted not to contain `<tool_call>`. That literal
flips qwen3.5 into native function calling, which ctx 1.4.0 crashes on, so a
prompt fragment reintroducing it would bring back the bug 0.4.6 fixed.

### Added — a coverage floor

Enforced at just under the measured numbers and verified by raising it to 95%
and watching the build fail. It exists to catch a slide. Raise it deliberately;
never lower it to make a build pass.

### Fixed — release:verify no longer fails for a reason unrelated to the code

`DisplayedVersion` and `Downloads` assert on build output, so running them
against the previous version's artifacts failed immediately after a bump. It
caught people out twice. `release:verify` now builds first, and the failure
message names the remedy.

### The gates, as they now stand

```
npm run release:verify
```

build · lint · 532 tests · coverage floor · production audit · vendored audit ·
release smoke · search and readiness journeys · plugin journey · approval gate ·
packaged runtime

The last four drive the running product, and the last one drives the built
artifact rather than the source — the distinction that let 0.4.7 ship a desktop
app which could not start while every other gate was green.

## [0.4.9] - 2026-08-19

Error handling and documentation, both taken to the standard where a guard
enforces them rather than a good intention.

### Fixed — a broken config.json silently threw away your setup

Two catch blocks discarded the same error, and between them they produced the
worst kind of failure: the product behaving differently with nothing anywhere
saying why.

- `SettingsProvider` fell back to defaults when `config.json` would not parse.
  Falling back is right — the defaults are the safe values — but in silence it
  means every setting the user chose is being ignored, security toggles
  included.
- `server.js` did the same at startup, so `watchedDirectories` came back empty
  and every project vanished from the sync. You would open YodaMan to find your
  workspaces gone.

Both now log at high severity with the path and how to fix it.

### Changed — every caught error is now used or explained

An audit of all 213 catch blocks found 41 that discarded an error with no
logging and no explanation. The two above were bugs; the rest were legitimate —
a stat on a file that may not exist, a probe whose whole job is to answer yes or
no. But *legitimate* and *silent* are indistinguishable to the next reader, so
each now says why silence is correct.

`tests/infrastructure/ErrorHandling.test.js` holds the line: a catch must log,
rethrow, use the bound error, or carry a comment. The comment requirement is not
box-ticking — writing one forces the question "is silence actually correct
here?", which is precisely the question nobody asked for those two config bugs.

Getting that guard honest took three attempts. The first passed on a
deliberately silent catch, because a six-line comment window let unrelated JSDoc
satisfy it. Tightened to two lines it immediately found seven more real cases
the loose version had been hiding, two of which turned out to be release scripts
handling errors through `console.error` — legitimate, and now recognised.

### Added — documentation that cannot rot quietly

AGENT.md opens by warning that hand-maintained counts and paths drift. They had:
current docs still claimed 0.4.4 four releases on, the publishing guide named a
`.vsix` from a version nobody ships, and the release gates, the error-handling
standard and `OLLAMA_CONTEXT_LENGTH` were documented nowhere outside the
changelog.

- The Development Guide covers all four release gates and what each proves, and
  records that a version bump must be followed by a build before
  `release:verify` means anything.
- The configuration guide covers `OLLAMA_CONTEXT_LENGTH` — what Ollama defaults
  to, why 4,096 against a 262,144-token model quietly degraded every answer, and
  how to check and change it.
- `tests/infrastructure/DocumentationAccuracy.test.js` enforces three things:
  every repository path named in current docs exists, every documented npm
  script exists, and no current doc claims a version other than the one
  shipping.

History is deliberately exempt. A changelog recording the removal of
`ModeToggle.jsx` must name the file it removed; rewriting that to satisfy a
linter would falsify the record.

## [0.4.8] - 2026-08-19

### Fixed — 0.4.7's desktop app could not start

`shared/` was never in electron-builder's file list. 0.4.7 made the backend
depend on it — `AgentReasoningEngine` requires `shared/pluginInvocation` for the
plugin capability map — so the packaged runtime died immediately with
`Cannot find module '../../shared/pluginInvocation'` and the app opened to a
diagnostics screen with nothing behind it.

Every release gate passed while that build was broken, and the reason is worth
recording. Unit tests, the plugin and approval journeys, and release smoke all
run `node server.js` from the source tree, where `shared/` obviously exists.
None of them booted the thing that actually ships. **A test of the source is not
a test of the artifact.**

- `shared/**/*` added to `electron-builder.json`. The npm tarball already
  included it, so only the desktop build was affected.
- **`npm run test:packaged`** boots the `server.js` inside the built `.app` and
  waits for `/api/health`. Any file missing from the package surfaces here as
  the module resolution failure it is, and the output names the missing path and
  the file list to add it to.
- That gate now runs **inside `desktop:dist:all`**, immediately after packaging,
  so a build that cannot start fails the build instead of reaching a user. It is
  also the eighth step of `release:verify`.

### Added — the version on the diagnostics screen

When that screen is all a user can see, the build they are looking at is the
first thing anyone needs to establish. It now reads
"YodaMan — Diagnostics Dashboard v0.4.8".

## [0.4.7] - 2026-08-19

Observability and honesty. 0.4.6 fixed the agent's tool-call path; this makes the
conditions that broke it visible, and closes the gaps the audit left open.

### Added — the runtime tells you when it is unwell

- **`npm run health:watch` / `health:check`** — an external watchdog. It has to
  be external: the failure it looks for blocks the event loop, so an in-process
  check is blocked with everything else. It names **wedged** — port listening,
  request timing out — separately from **down**, because a wedged runtime looks
  alive to `lsof` and busy to `ps`, and both readings are true and useless. On
  detection it prints the evidence-capture command before a restart destroys the
  cause. Exit codes suit cron or a monitoring agent. Detection had been manual,
  and a wedged runtime once ran unnoticed for seventeen hours.
- **A Diagnostics button** on the dashboard re-runs the dependency doctor and
  shows the report. Those checks already ran at startup and fed `/api/health`,
  but nothing could re-run them and show the output.
- **A taken port** now fails with its own message and exit code 2, naming the
  port and a command to find the culprit. Reported as a generic uncaught
  exception it read as a crash — and to anyone launching the desktop app it read
  as nothing at all: a black window with no runtime behind it.

### Fixed — Ollama was serving 4,096 tokens against a model built for 262,144

`OLLAMA_CONTEXT_LENGTH` defaults by VRAM and this class of machine gets the
smallest tier. Everything the agent did was shaped by that ceiling: the prompt
plus retrieved chunks overflowed, `llama-server` runs `--context-shift` so it
dropped from the front, and the model answered with its tool instructions
truncated away. It read as a weak model for months.

YodaMan cannot set it — Ollama is a separate service — so it now measures it,
reports it in `yodaman doctor`, the dashboard and `/api/health`, and **offers to
fix it**: one button sets the recommended value and restarts Ollama. That path is
deliberately narrow, because it writes a launchd plist and restarts a service —
its own endpoint rather than the agent's command tool so no model can reach it,
a value checked against a fixed list, the plist backed up and restored if the
restart fails, and a confirmation that says Ollama will briefly be unavailable.

The agent also stops trimming when the window is genuinely large: compaction was
a response to a small serving window, not a small model.

### Fixed — search was indexing and returning our own output

- **ctx was indexing `graphify-out/`**, Graphify's AST cache. A search for
  "Architecture_Overview_Document" returned five copies of
  `graphify-out/cache/ast/86c41b74….json` instead of the document, and every hit
  for that query was a cache file. The agent was being handed them as context.
  Indexing now excludes generated directories, and any that slipped in already
  are filtered before ranking.
- **Graph ranking was therefore dead.** Cache files are never in the knowledge
  graph, so nothing matched and ranking silently fell back to semantic-only
  while the API kept advertising the four-signal blend — the product's headline
  claim and the Trace tab's entire content. It now warns when a graph exists and
  matched nothing.
- **`ctx index` refuses an already-indexed project without `--force`**, and
  YodaMan never passed it. Every reindex of an existing workspace was a no-op
  that reported success — including Sync Repository, and the remediation the
  runbook gives support for a stale workspace, which is why stale workspaces
  stayed stale. ctx writes failures to stdout, so the refusal had been logged at
  info level for as long as it existed; errors now log as errors.
- **`GET /api/projects` reported `files: 0` and `chunks: 0`** for every project,
  indexed or not: ctx returns those as `fileCount` and `chunkCount`.

### Added — a third release gate, and a plugin that runs instantly

- **`npm run test:journeys`** covers search ranking and workspace readiness
  without the agent loop, so it is fast and deterministic. It found all three
  search defects above.
- **Naming a plugin now runs it directly.** "Run CodeTrooper" costs a retrieval,
  a model round-trip and about 50 seconds to work out what the user already
  said, and a 9B model got it wrong often enough to fail a release gate.
  Measured: 52s to 2s, and deterministic. Narrow by design — exact name match on
  a loaded plugin, and anything that can modify still takes the path with the
  approval gate on it.
- The chat dropdown no longer offers plugins that cannot be driven from chat.

### Fixed — verification that lied

Jest and eslint both scanned `.claude/worktrees`, so a background task's
worktree ran as part of verification: 984 tests instead of 492, and an older
commit's already-fixed lint errors reported as current. `Downloads.test.js`
asserted build artifacts that are gitignored, so it failed every CI run on a
fresh checkout — which is why this repository had no green CI run since at least
4 August, and that red hid two genuinely failing agent tests for a fortnight.

`npm run release:verify` now chains eight gates in ascending cost.

## [0.4.6] - 2026-08-18

A handover audit started here, and what it found went deeper than expected: the
verification machinery was broken, and because it was broken it had been hiding
a product that could not perform its central function. The agent could not call
a single tool. Prose questions worked, so nothing looked wrong.

Every finding below was reproduced before it was fixed, and each fix was
verified by driving the real product rather than a mock.

### Added — plugins are reachable from the chat composer

Every shipped plugin carried a `💡 Chat usage:` hint precisely because the only
way to run one was knowing the phrase. The composer dropdown now lists them
alongside the task presets.

Selecting one **fills the box; it does not run anything.** A preset is a prompt
template, but a plugin is a tool execution with declared permissions, and
collapsing that difference into one click would have quietly turned a menu into
a trigger. Inserting keeps the "you press Send" contract, leaves the text
editable so parameters can be adjusted, and teaches the chat syntax rather than
hiding it.

- The list comes from `GET /api/plugins`, never a hardcoded array — plugins can
  be uploaded or removed while the app is running, and a menu offering one that
  is not loaded is a support ticket.
- Plugins carry a short, literal statement of what their permissions allow —
  "writes files", "runs commands", "starts agent tasks" — mapped explicitly
  against the permission allowlist. The first attempt pattern-matched the
  permission strings and called anything containing "write" able to modify your
  code, which flagged `audit:write` (the audit log, nothing else) and so
  described a VR graph viewer as capable of changing files. A label that
  overstates is worse than none: it teaches people to ignore the one that
  matters.
- Nothing here bypasses the approval gate. A plugin that writes still stops for
  the same diff, dependents and test-coverage review as any agent write.

### Fixed — the agent could not call a single tool

0.4.5 shipped with every agent task that needed a tool failing. Prose questions
worked, so the runtime looked healthy right up to the moment a user asked for
real work. Four separate defects, each sufficient on its own:

- **The tool-call delimiter.** Prompting qwen3.5:9b with the literal string
  `<tool_call>` flips it into Ollama's native function-calling mode. ctx 1.4.0
  mishandles that and reports the resulting `TypeError` as "Failed to connect to
  Ollama server", which sent us to inspect an Ollama that was healthy the whole
  time. The wire format is now `TOOL_CALL {...}` as literal text; the old form is
  still parsed. Reported upstream in
  `docs/upstream/ctx-1.4.0-tool-call-crash.md`.
- **The prompt did not fit the model's context.** Ollama runs qwen3.5:9b at 4096
  tokens. Our prompt was ~2200 and ctx prepended five retrieved chunks on top, so
  the total overflowed — and llama-server runs with `--context-shift`, which
  drops from the *front*: the system prompt carrying the tool instructions. The
  model answered with its instructions truncated away. Small models now get a
  tighter budget and fewer chunks. Measured on the same task: 280s timeout → 74s,
  8–10 iterations → 2, 9-of-22 empty answers → 0.
- **Relative paths resolved against the wrong root.** `resolveAllowedPath()`
  anchored them to the runtime's working directory, so the agent asking for
  `core/package.json` got `.../core/core/package.json` and "File not found" for a
  file plainly on disk. They now resolve against each allowed workspace;
  containment is unchanged and still refuses traversal.
- **The workspace path was never stated.** Plugins declare `workspacePath` as a
  required absolute path and nothing told the agent what it was, so it correctly
  replied that it needed a path nobody had given it. The prompt now states it,
  and an omitted value is filled from the active project.

Also: the prompt's tool-call example used a placeholder literally named `tool`,
and the model copied it — three `Tool not found: tool` iterations on every task
before it found the real one. It is now a real worked example.

### Added — release gates that exercise the product, not just the code

Every existing gate inspected artifacts: code, dependencies, configuration,
packaging. None asked the product to do the thing it exists to do, which is how
the agent shipped completely broken with 492 tests green.

- **`npm run test:plugins`** drives every installed plugin through the agent
  using the exact phrase the chat dropdown inserts, and fails if the agent never
  reaches a tool. The phrase derivation moved to `shared/pluginInvocation.js` so
  the gate and the UI cannot drift.
- **`npm run test:approval`** drives the agent into proposing a write, snapshots
  the file at the moment it pauses, rejects the proposal, and asserts the file
  was untouched both while pending and after the rejection — the product's
  central safety claim, verified end to end for the first time.
- **`npm run release:verify`** chains all seven gates in ascending cost.

Both journey gates skip where Ollama is unavailable, and the runbook states
plainly that a skip is not a pass. Timeouts are set from a full sequential run
of every plugin rather than a single sample.

### Fixed — spawned worktrees corrupted lint and tests

Jest and eslint both scanned `.claude/worktrees`, so a background task's
worktree ran as part of verification: 984 tests instead of 492, and an older
commit's already-fixed lint errors reported as current. Any background task
running during a release check produced a false red in two independent gates.

### Fixed — CI had never passed, and it was hiding a real regression

Every CI run since 4 August failed, including the release workflow on tag
`v0.4.3`. The pipeline died at `lint`, so the test step never ran, so nobody saw
that two tests were also failing. Two defects, each concealing the other.

- **Lint**: two empty `catch {}` blocks, added by `b2e1ae0` (compact mode) and
  `852bb99` (JSON repair). Both feature commits broke the build; neither was
  caught, because the pipeline was already red.
- **Tests**: `b2e1ae0` put `ctx config get default_model` — a subprocess with a
  5-second timeout — on the hot path of *every* agent task, re-probed each time,
  for a value that changes when the user edits their ctx config. One task cost
  ~1s before doing any work. In tests it delayed approval registration past the
  window, so `should continue when a write approval is rejected` timed out; the
  orphaned task then consumed a mock belonging to the next test, which is why
  `should report malformed tool calls as task errors` failed too. Two failures,
  one cause.
- **Fix**: cache the detection with a 5-minute TTL, and share the in-flight
  promise so concurrent tasks do not each spawn a probe. First call 908 ms,
  every subsequent call 0 ms.

Suite is 492/492 across 63 suites, lint is clean, `release:smoke` passes.

### Fixed — a vulnerable bundle shipped while the audit gate reported clean

`vis-network` is a devDependency, so `npm audit --omit=dev` reported **0
vulnerabilities** — but `scripts/sync-vendor.js` copies its bundle into
`public/vendor/`, and `public/` ships in both the npm tarball and the desktop
app. A vulnerable 9.1.6 bundle had been reaching users while CI called the tree
clean, and the comment justifying that gate asserted dev advisories "never reach
a consumer of the published package", which was false for this package.

- Upgraded to `vis-network@10.1.1`, outside the advisory range. Verified by
  rendering a graph with the exact API Graphify's artifacts use (`new
  vis.DataSet`, `new vis.Network`) — `afterDrawing` fires, no console errors.
- Added `npm run audit:vendored`, a CI gate that cross-references
  `public/vendor/MANIFEST.json` against `npm audit` so anything vendored is
  audited regardless of which dependency block it sits in. Verified it exits 1
  on a vulnerable package and 0 when clean.
- The manifest recorded a **hardcoded** `9.1.6` and kept reporting it after the
  upgrade while shipping different bytes. It now reads the installed version, so
  the record cannot drift from the artifact.

`nanoid` remains flagged, via `postcss`. It is build-time only and never ships,
which is what `--omit=dev` is for.

### Fixed — the same symlink cycle, on the plugin upload path

`walkArchiveFiles` recursed with `fs.statSync`, which resolves a symlink to its
target, with no depth cap and no cycle detection — the identical defect that
pinned the runtime at 100% CPU for 17 hours in 0.4.5, except this walk runs over
an archive somebody uploaded, so the cycle can be authored deliberately rather
than arriving by accident. Now refuses symlinks via the dirent and caps depth. A
crafted archive that would have wedged the loop completes in 0 ms.

### Changed — readiness no longer rescans on every poll

`GET /api/readiness` walked every watched tree synchronously, ~310 ms of blocked
event loop per call, on a route the dashboard polls. Cached per project for 10
seconds: ten polls now cost 2 ms in total.

### Changed — operational and ownership gaps closed

- **New runbook section**: "Runtime is listening but answers nothing (100% CPU)"
  — the failure whose every ordinary check looks healthy. Covers how to
  recognise it, how to capture a stack sample *before* restarting destroys the
  evidence, and why `SIGTERM` does nothing (the handler needs the same blocked
  loop). It also states plainly that detection is manual.
- **Added `.github/CODEOWNERS`**, which the runbook already referenced as
  existing.
- **Node**: `engines` now says `>=20`, and CI moved from the deprecated Node 20
  runner to 22, which is what development actually runs on.
- Cleared all remaining lint warnings, so a clean run means something.

### Changed — dependencies

`fs-extra` and `ws` to current patches. `chokidar` stays on 4; the 5.x bump is a
major on the file watcher and buys only a patch-level fix.

## [0.4.5] - 2026-08-18

### Fixed — runtime wedged at 100% CPU on any workspace containing a Flutter project

The desktop app opened to an empty diagnostics window. The runtime logged a clean startup — seven projects, `startup_health_summary healthy: true` — and then answered nothing. It held port 3090, accepted TCP connections, and never replied, so relaunching could not take the port either. One such process had been spinning for 17 hours and ignored `SIGTERM`.

- **Root cause**: `latestSourceMtime()` in `GraphifyService.js` recursed using `fs.statSync()`, which resolves a symlink to its target. A symlinked directory therefore reported `isDirectory() === true` and the walk followed it. Flutter writes `.plugin_symlinks/` and `.symlinks/` entries that point back into an ancestor directory, so any watched project containing a Flutter app produced an infinite descent. There was no depth cap and no cycle detection.
- **Why it took the whole runtime down**: the walk is synchronous. A cycle blocks the event loop outright, which is why the process could bind and accept but never respond, and why `SIGTERM` did nothing — the signal handler needs the same blocked loop. `SIGKILL` was the only way out.
- **The trigger path**: Electron's startup poll calls `GET /api/readiness`, which reaches `WorkspaceReadiness.js` → `graphifyService.freshness()` without `scanSources: false`. Six of the eight `freshness()` call sites already passed that flag, so the cost of this scan had been worked around piecemeal rather than fixed at the source.
- **Fix**: skip symlinks using the dirent's `isSymbolicLink()`, which describes the link rather than its target, and cap recursion depth as a backstop for any cycle that check would miss. Fixing the walker covers every caller at once.
- **Measured**: a watched project reached 121,674 directories at depth 84 before a probe gave up, the path repeating `.plugin_symlinks/atomic_webview/example/linux/flutter/ephemeral/`. The same project now resolves in 150 ms, and `/api/readiness`, `/api/health`, `/api/status` and `/api/projects` all answer in under a second with CPU returning to idle.

### Fixed — website claimed four things the code does not do

Every claim on the site was checked against the code. Four were wrong:

- **Search ranking**: the Trace section advertised three signals blended `0.6 + 0.25 + 0.15`. `GraphRanker.DEFAULT_WEIGHTS` is four signals at `0.50 / 0.20 / 0.15 / 0.15` — `specCoverage` was missing from the page entirely.
- **Impact Analysis**: advertised a hop depth of 1–5; `ImpactAnalysisTab.jsx` offers 1–4.
- **Stardust**: described as "four cross-tool views"; it ships eight tabs.
- **Mobile**: the docs page promised push notifications. The Expo app contains no notification code at all.

### Fixed — the docs page was unreachable on mobile

`styles.css` hides the header nav below 820px and reveals it only via `.nav-open`, but `docs.html` shipped without a `.nav-toggle` button and without the toggle script that `index.html` has. On any phone the navigation was `display: none` with nothing able to open it. The button and script are now present on both pages.

### Changed — Windows artifacts are no longer published from a macOS build

`release.yml` documents that a macOS-hosted NSIS build can die mid-package and leave a truncated stub `.exe` that looks plausible and does not install, and the site states that no Windows build ships from here. `sync-website-downloads.js` was nonetheless copying one into `website/downloads/`, where it is fetchable by URL whether or not a card links to it. The sync step now skips Windows artifacts unless it is running on a Windows host, and says why.

### Changed — documentation reframed around the three-tool pillar

- The README opening now states what YodaMan is before describing the architecture, and no longer describes Ollama as optional — the same file lists it under Prerequisites and as a required dependency of `yodaman doctor`.
- The legacy "Core Pillars" section (four principles already covered by the "Why YodaMan" bullets) was removed from both the README and the site, which had drifted out of agreement.
- `docs.html` gained the three-tool pillar and Stardust sections it never had, and its API reference now covers the Stardust routes, search, health, readiness, plugins, and the WebSocket feed, with paths and methods checked against `backend/`.

## [0.4.4] - 2026-08-04

### Fixed — black window on launch

The 0.4.1 desktop build started to an empty black window. The runtime was healthy and every asset returned HTTP 200, so nothing looked wrong from the server side — but the UI never appeared.

- **Root cause**: `Stardust.jsx` referenced the `BarChart3` icon in its `TABS` array without importing it from `lucide-react`. The reference is evaluated while the module loads, so the bundle threw `Uncaught ReferenceError: BarChart3 is not defined` before `createRoot` ever ran. `<div id="root">` stayed empty against the `bg-gray-950` body, which is the black screen.
- **Fix**: added `BarChart3` to the `lucide-react` import in `src/components/Stardust.jsx`. The Impact tab (added in 0.4.1) is what introduced the unimported reference.
- **Fonts unblocked**: the runtime's Content-Security-Policy had no `font-src`, so it fell back to `default-src 'self'` and blocked every `data:` font Vite inlines. The bundled Inter, Outfit and JetBrains Mono faces were silently dropped in favour of system fallbacks. `font-src 'self' data:` added in `server.js`.

### Fixed — crash card when opening the workspace chat

With the black window fixed, the chat view replaced the UI with "YodaMan hit a display error — `holocronAvailable is not defined`".

- **Root cause**: `AgentChatTab.jsx` read `holocronAvailable` in its render and called `setHolocronAvailable` from an effect, but the `useState` pair was never declared. The setter calls sat inside a `.then()` whose `.catch()` also threw, so they surfaced only as a silent unhandled rejection; the render read is what reached `AppErrorBoundary`.
- **Fix**: declared `const [holocronAvailable, setHolocronAvailable] = useState(false)` alongside the other VR state.
- **Why the launch smoke test missed it**: the first paint never mounts `AgentChatTab`, so a crash inside it is invisible to a test that only checks the initial render. That gap is now closed by `ComponentRender.test.js` (below).

### Fixed — /api/ask error handler threw instead of reporting

Found while auditing the 0.4.1 dead-code sweep for further fallout, not from a bug report — it only fires on the error path, so nothing surfaced it.

- **Root cause**: the same cleanup that removed the Code/Docs mode toggle deleted the `mode` variable from the `/api/ask` route but left `mode` in the payload its `catch` block logs. Any failure in `/api/ask` therefore threw `ReferenceError: mode is not defined` from inside the error handler, discarding the original error and never sending the intended 500 response.
- **Fix**: dropped the stale `mode` field from the `ask_failed` log payload in `RestController.js`.

### Fixed — status bar reported v0.3.8

The build badge in the status bar was a hardcoded string and had not moved since 0.3.8, so the running app told users it was three versions behind. Spotted by reading the live UI during release verification, not by any test.

- **Fix**: `vite.config.js` now injects `__APP_VERSION__` from `package.json`, and `StatusBar.jsx` renders that. The badge follows the version bump automatically from here on.
- **Guard**: `tests/frontend/DisplayedVersion.test.js` fails on any literal `vX.Y.Z` in `StatusBar.jsx`, and checks the built bundle carries the current version.

### Added — crash regression guards

Three layers now stand between this bug class and a release. Each was verified by re-introducing the original defect and confirming the test fails:

- **`tests/frontend/RendererSafety.test.js`** — sweeps every file in `src/` for identifiers that are never bound, at any nesting depth, against an allowlist of browser globals. Catches both 0.4.x crashes and names the exact `file:symbol`. The previous check only inspected JSX element positions (`<BarChart3 />`), so neither `{ icon: BarChart3 }` nor a missing `useState` pair was visible to it. Runs in under a second and needs no build.
- **`tests/frontend/ComponentRender.test.js`** — server-renders each top-level view for real, so a crash in a tab the first paint never mounts still fails the suite. Uses `react-dom/server` plus a small browser stub; effects never run, so nothing touches the network. `Stardust` and `App` are excluded because `useStardustLive` calls `useSyncExternalStore` without a `getServerSnapshot`, which `react-dom/server` rejects — they remain covered by the sweep above.
- **`tests/electron/DesktopRenderSmoke.test.js`** — boots the real runtime, points Electron at it exactly as `electron/main.js` does, and fails unless `#root` has mounted children with no renderer `ReferenceError`. It also asserts the mounted UI is *not* `AppErrorBoundary`: the boundary renders into `#root` too, so "root has children" alone reports a crash card as a healthy render.
- **`tests/infrastructure/NoUnboundReferences.test.js`** — the same sweep over `backend/`, `shared/`, `electron/`, `plugins/`, `scripts/` and `bin/`, which is where the `/api/ask` regression above was hiding. Generated bundles are skipped: mangled single-line output says nothing about hand-written mistakes.
- **Test infrastructure**: `tests/helpers/sucraseTransform.js` transforms the frontend's JSX/ESM for Jest via sucrase (already in the toolchain — no new dependency) and delegates everything else to `babel-jest`, which is what hoists `jest.mock()` calls.
- **Release path enforcement**: `desktop:dist` and `desktop:dist:all` now run `npm run test:render` between the Vite build and electron-builder, so a build that cannot render cannot be packaged.

## [0.4.1] - 2026-08-04

### Added — Stardust-powered search

Search now truly harnesses all three mandatory tools with a fourth signal: spec coverage from OpenSpec. The ranking formula is:

> `score = semantic × 0.50 + proximity × 0.20 + centrality × 0.15 + specCoverage × 0.15`

- **`GraphRanker.buildSpecIndex()`**: reads OpenSpec specs and builds a coverage set. Files cited in specs get a ranking boost (specCoverage = 1.0); undocumented files score 0. The boost moves architecturally documented files above undocumented ones with otherwise equal scores.
- **Unified multi-source results**: `GET /api/search` now runs code and docs searches in parallel and merges them with `_source` provenance tags (`code` | `docs`). No more binary code/docs split.
- **Per-hit spec flags**: every search result carries a `specFlag: { covered: true, specs: [...] }` annotation showing which OpenSpec specs describe the file.
- **Default top bumped**: 10 → 15 for richer result sets.

### Added — Enhanced impact analysis

The chat approval gate's ImpactPanel now includes:

- **Spec awareness**: shows which OpenSpec specs describe the file being modified, or "No specs describe this file."
- **Graph freshness badge**: "graph current" / "graph stale" indicator so the reviewer knows if risk data is fresh.
- **Configurable depth slider**: expandable 1–4 hop control inline in the approval gate.
- **Cross-reference link**: "Full cross-reference (Stardust Compose)" button linking to the file's three-tool cross-reference.
- **New Stardust Impact tab**: 8th tab with dedicated impact analysis tool — file path input, hop depth selector, risk verdict, dual-panel Graphify structure + OpenSpec awareness breakdown, and test coverage detail.
- **Backend**: `specDrift` imported into `AgentReasoningEngine`; `specImpact` now included in `pendingApproval` and `approvalEvent` payloads.

### Removed — Code/Docs mode toggle

The Code/Docs toggle was purely cosmetic — it posted to `/api/mode` which only validated and echoed back without changing any behavior. Search, agent, and context retrieval all ignored it.

- Toggle buttons removed from `AgentChatTab.jsx`
- `queryMode` state, `api.setMode()` deleted
- `POST /api/mode` route removed from `RestController.js`
- `ALLOWED_MODES` constant and `validateMode()` function deleted
- `mode` parameter cleaned from `/api/ask` endpoint
- Dead `classifyQuery` import removed from `searchRouter.js` (unified search always returns both)
- `yodamanClient.prototype.setMode()` removed (called removed endpoint)
- VS Code extension `getClient().setMode()` call removed

### Removed — dead code sweep

Reachability analysis over every real entry point found six unreachable modules:

- **`backend/services/contextEngine.js`**, **`backend/services/chatHandler.js`** — no importers
- **`src/components/ChatWindow.jsx`**, **`ModeToggle.jsx`**, **`Chat/ModeToggle.jsx`**, **`ManualWindow.jsx`** — superseded or never imported

Three dead exports also removed: `GraphifyService.artifactTypes`, `chatHandler.getMode`, `FileUploader.ACCEPTED_UPLOAD_TYPES`.

### Fixed

- **Undeclared test dependencies**: `@babel/parser` and `@babel/traverse` now in `devDependencies`.
- Removed unused dependencies: `axios`, `wait-on`.

### Changed

- Website: "New in" nav link now reads **Stardust** so the label stops going stale.
- `docs/architecture/architecture.md`: updated to match deleted modules.

## [0.4.0] - 2026-08-03

### Added — Stardust real-time dashboard

The Stardust tab is now a full real-time OpenSpec dashboard, borrowing and adapting patterns from opsx-ui (RayIci/opsx-ui, MIT):

- **Change Board**: card-based navigation with task progress bars, validation health icons, and "updated X ago" timestamps. Each change card is clickable — selecting one opens a side-by-side spec diff viewer.
- **Spec Diff**: operation-grouped deltas (ADDED/MODIFIED/REMOVED/RENAMED) with colour-coded badges, left-border accents, and a Proposed / Side-by-side view toggle.
- **Activity Feed**: slide-over drawer showing live file events from `openspec/` — created, modified, removed — with icons and timestamps. Pushed over WebSocket in real time.
- **Architecture Drift Panel**: first-class UI for SpecDrift — stale spec references and undocumented modules shown with severity colouring and dependency counts.
- **WebSocket + chokidar backend**: `StardustLive` watches the `openspec/` directory, pushes snapshots and activity events to all connected clients, and provides REST fallbacks (`GET /api/stardust/board`, `GET /api/stardust/deltas/:name`, `PUT /api/stardust/validation/:name`).
- **Live store**: `useStardustLive` hook using React's `useSyncExternalStore` for optimal batching with auto-reconnect and REST seeding.

### Added — Three-tool composition GUI

Three new tabs that make the "Context Expert + Graphify + OpenSpec compose" claim tangible:

- **Compose tab**: file-centric cross-reference. Enter any repo path to see what OpenSpec specs describe it, its Graphify structural position (dependents, centrality, blast radius, test coverage), and how Context Expert ranks it. Backed by `GET /api/stardust/compose`.
- **Trust tab**: unified health dashboard. Per-tool status cards (Context Expert index, Graphify graph, OpenSpec CLI), overall WorkspaceReadiness verdict, and degraded/pending detail panels. Pulls from `/api/health` and `/api/readiness`.
- **SearchTrace tab**: transparent ranking explanation. Every search result shows its semantic × 0.6 + proximity × 0.25 + centrality × 0.15 breakdown with colour-coded bars.

### Fixed

- **Plugin `minYodaManVersion` corrected**: `core/plugins/plugin.json`, `Holocron VR/plugin.json`, `Holocron VR/dist/plugin.json`, and `lightsaber/plugin.json` all had `minYodaManVersion: "1.0.0"` — a fictional version that would prevent plugin loading. Corrected to `0.3.8` (core/Holocron VR) and `0.3.0` (lightsaber).
- **Lightsaber plugin version**: `plugin.json` said `1.0.0` but `package.json` is `0.3.0` — corrected.
- **CodeTrooper test hang**: default `excludeDirs` now includes `release`, `graphify-out`, `coverage`, and `downloads`. Test uses a 4-file fixture instead of scanning the entire 6.2GB project tree. Full suite runs in 1.5s instead of hanging for 4m39s.
- **Stale `yodaman-0.2.2.tgz`** deleted and gitignored.
- **Holocron VR release zips** gitignored (`*.zip`).

### Changed — Documentation

- **`docs/api/api.md`**: complete rewrite — all 66 routes documented (was ~33). Added 10 new sections: Git API, Plugins API, Stardust Live, Health & Readiness, Sessions, Settings, Upload, and more.
- **`docs/architecture/architecture.md`**: complete rewrite — added backend/services, backend/stardust, backend/utils, all 20 infrastructure modules, 9 v0.3.8 services, accurate frontend component list, StardustLive and new Stardust components.
- **Version references**: `Management-Overview.md` bumped from 0.3.0 to 0.3.8, `AGENT.md` stale claim removed, `publishing.md` and `PUBLISHING.md` vsix versions updated, `setup.md` bumped, `runbooks.md` expanded with `yodaman doctor` and health/readiness endpoints.
- **Lightsaber README**: test-coverage action docs updated to reflect v0.3.8 graph-based behaviour.
- **Holocron VR docs**: version numbers corrected from fictional 1.0.0 to actual 0.5.1.
- **core/README.md**: fixed monorepo path, removed duplicate npm install.
- **Dockerfile**: added missing `@fission-ai/openspec`.
- **`user_manual.md`**: added prerequisites, `npm run dev`, new Stardust 7-tab layout.

### Added — Agent-driven OpenSpec workflow

- **Agent tools**: `specPropose`, `specValidate`, `specArchive` added to ToolBox.js (tools #12-14). The agent can now create OpenSpec change proposals, validate them against specs, and archive completed changes — following the full Propose → Validate → Apply → Archive workflow.
- **Agent system prompt**: updated in AgentReasoningEngine.js to instruct the agent to plan before coding and use specPropose for significant features. DefaultCodingSkill.js includes OpenSpec workflow guidance with specDrift pre-check.
- **Stardust Commands tab**: Propose button alongside Validate, Archive, List Changes, and List Specs. Creates `openspec/changes/<name>/` with proposal.md, design.md, and tasks.md.
- **PipelineStrip**: persistent cross-tab bar showing Context Expert → Graphify → OpenSpec pipeline state with live readiness dots.
- **Stardust Diagnostics tab**: in-app OpenSpec version check, project status, and one-click install/init.
- **7-tab Stardust layout**: Board, Drift, Compose, Trust, Trace, Diagnostics, Commands.

### Added — earlier in 0.3.8 cycle

## [0.3.8] - 2026-08-01

### Added — architecture drift detection

The capability that only exists because all three dependencies are mandatory: OpenSpec holds the architecture you said you would build, Graphify holds the one you did, and nothing compared them. A graph-only tool has no notion of intent; a spec-only tool has no notion of reality.

- **`GET /api/stardust/drift`** and a `specDrift(project)` agent tool report two kinds of divergence: **stale references**, where a spec cites a file the graph has never seen because it was renamed or deleted, and **undocumented modules**, where a heavily depended-on file has no spec describing it. Verified on this repository's real graph, where it correctly identified `test_ctx_version.js` — deleted earlier in this same release — as a stale spec reference, and ranked `ContextEngine.js` (11 dependents) and `api.js` (11 dependents) as the most load-bearing modules with no recorded intent.
- Deliberately derives intent from what spec prose actually cites rather than requiring a new machine-readable architecture format. A reference given by bare filename is matched against the graph by basename, so ordinary spec writing does not produce false alarms.
- **`GET /api/stardust/context`** grounds a proposal before it is written: the real architectural hubs a spec can cite, plus per-target blast radius and risk. A spec written without the graph invents module names and under-counts impact.
- New `GraphFacts` service answers workspace-wide structural questions from one graph read — orphaned files, per-file test coverage, and centrality — replacing the filesystem re-derivation the plugins were each doing separately.

### Fixed — shipped plugins now use the graph they depend on

- **Droid-Sweep was guessing.** It detected dead code by building a regex from each file's basename and searching every other file's text. That reported a file as used whenever its name appeared in any string, conflated two files sharing a basename, and missed aliased and dynamic imports entirely. It now asks the graph for files with no incoming dependency edge. On this repository that took the candidate list from noise down to three files — `backend/services/contextEngine.js`, `src/components/ChatWindow.jsx`, and `src/components/Chat/ModeToggle.jsx` — each confirmed unreferenced. Two of the three were reported as *used* by the old basename approach. Entry points that no code imports (Electron main and preload, the VS Code extension entry, React Native's `App.js`) are excluded rather than flagged. The text scan remains as a fallback for workspaces with no graph, and the response states which method produced the answer.
- **lightsaber's test-coverage penalty did nothing.** `healthScore` docks 20 points for coverage below 50%, but the only call site passed just `changeFrequency` and `complexityScore`, so `fd.testCoverage` was permanently `undefined` — permanently below the threshold — and every file took an identical 20-point hit. `todoCount` was never passed either, so that penalty was always zero. Two of the four advertised scoring factors did no work. Coverage now comes from resolved graph edges and TODO counts from the scan the plugin already ran; the penalties vary per file, and untested files are named.
- **The `test-coverage` action measured the wrong thing.** It returned the ratio of test files to source files, which says nothing about whether any given file is tested — one enormous test file scored well. It now reports the percentage of source files a test actually reaches, and lists untested files ordered by how many other files depend on them. `ratio` is retained for existing consumers, with its meaning documented.
- **The TODO scan searched `node_modules`.** It returned 500 hits dominated by dependencies, and with a `head -500` cap real project TODOs could be crowded out entirely. Now excluded: on this repository, 500 dependency hits became 5 genuine ones.

### Changed — visual language

The product is named after a Jedi and ships plugins called Lightsaber, CodeTrooper and Holocron; the interface now commits to that instead of hinting at it. Every device below is semantic rather than decorative, and none of it moves for anyone with `prefers-reduced-motion` set.

- **A faction palette with meaning.** Four CSS custom properties formalise colours the app was already using ad hoc: `--holocron` (cyan) for projected data — the graph and VR; `--imperial` (amber) for specs and warnings; `--sith` (crimson) for destructive actions and high risk; `--jedi` (green) for healthy and approved. The mapping is a vocabulary, so colour now tells you what kind of thing you are looking at.
- **HUD corner brackets** (`.hud-frame`) on surfaces where you are asked to assess something before committing — the approval diff above all, framed in imperial amber like a targeting readout. Brackets only, no border, so it frames without boxing content in.
- **Holo projection** (`.holo-surface`, `.holo-scan`) on Graph Studio: faint cyan scanlines drifting on a 9-second cycle over an inset bloom, so projected data reads as projected. Kept deliberately low contrast — it must never compete with the graph itself.
- **Saber ignition** (`.saber`) — a blade of light sweeps across an action on hover and focus. Applied only to controls that commit something: Approve, Reject, Send, and Enter VR.
- **Starfield** texture on the status bar and the Holocron shell: five layers of very low-contrast points, static, as texture rather than ornament.
- **`.readout`** codifies the wide-tracked uppercase monospace label the app was repeating by hand in dozens of places.

### Fixed — test isolation

- **The test suite was writing into the live database.** `Database.js` hardcoded its path, so `Database.test.js` inserted `test-task-*` rows and fake audit entries straight into the user's real `yodaman.db` — they showed up in actual task history via `GET /api/agent/tasks`. The same coupling made the suite fail intermittently whenever the app held the file open, which is most of the time for anyone developing on it. `Database.js` now honours `YODAMAN_DB_PATH` (mirroring the existing `YODAMAN_CONFIG_PATH` convention), the test runs against a throwaway database it deletes afterwards, and a new assertion fails if the suite ever points at the real file again.

### Fixed — interface polish

- The status-bar clock re-rendered every second with proportional digits, so its width jittered continuously. Now set in `tabular-nums`, along with the diff's added/removed counts.
- **The app no longer fetches fonts from Google.** `src/index.css` opened with an `@import` to `fonts.googleapis.com`, so a product whose headline claim is local-first and private by design made a third-party request on every launch — and inside the packaged desktop app, which has no network to rely on, all three families collapsed to a generic system sans. Inter, Outfit and JetBrains Mono are now self-hosted through Fontsource (all OFL-1.1, so bundling is permitted) and Vite fingerprints the `.woff2` files into `dist/`. Verified in a browser: zero requests to any font CDN, and body, heading and monospace text resolve to the real faces rather than a fallback. Variable builds cover every weight in one file per subset, and `unicode-range` means only 4 of the 17 bundled subsets are actually downloaded for a Latin UI.
- `font-inter` and `font-outfit` had no fallbacks beyond `sans-serif`. Both now name the variable family first — Fontsource registers these as `Inter Variable` and `Outfit Variable`, so naming only the static family would have silently fallen back, reintroducing the very bug this change removes — then the static family, then a deliberate system face. `font-mono` is registered rather than assumed.

### Added — the three mandatory dependencies now compose

Context Expert, Graphify and OpenSpec were each wired to their own tab and nothing else. These changes make each one's output feed the next, so the cost of requiring all three buys something a single tool cannot.

- **Blast radius on the approval gate.** A proposed file write now shows what it reaches before you accept it: dependent file count, whether any test covers the path, the nearest dependents, and a risk verdict. New `ImpactAnalyzer` walks `graphify-out/graph.json` in-process — the `graphify affected` CLI returns prose, and the agent is blocked on the prompt while this runs, so counts are computed from the graph JSON directly. Containment edges (`contains`, `method`, `defines`) are deliberately excluded so a file's own symbols aren't counted as dependents.
- **Graph-reranked code search.** New `GraphRanker` blends Context Expert's semantic score (weighted 0.6) with graph proximity to the file you're working on (0.25) and node centrality (0.15). This matters most where retrieval has no opinion: the ctx filesystem fallback returns an identical score for every hit, so ordering collapsed to alphabetical. On a real query for `logger`, `Logger.js` moved from 10th to 1st and `package-lock.json` fell from 2nd to 6th. Reranking is advisory — no graph, or no graph coverage of the hits, returns the original order untouched.
- **The post-write loop is closed.** An approved write used to leave the index and graph stale, silently degrading the next answer. Workspaces touched by a task are now reindexed and re-graphed once when the task ends — once per task, not once per write, so a five-file change does not trigger five graph builds.
- **One workspace readiness verdict.** New `WorkspaceReadiness` collapses index state and graph build state into a single graded answer — `ready`, `stale`, `building` or `unindexed` — where the verdict is the weakest layer, never an average. Exposed on `GET /api/readiness` and inside `GET /api/health`, and shown as a badge in the Chat header so a stale answer is no longer indistinguishable from a correct one.

### Added
- **Agent write approvals are reachable again in the Chat tab.** The agent blocks on `awaiting_approval` until the user decides, but the Chat tab never rendered the prompt, so any task that tried to write a file hung indefinitely. The proposed change now appears inline as a diff with added/removed counts and Approve / Reject actions.
- **Stop button** for a running agent task, wired to `POST /api/agent/cancel`, plus handling for the `task_cancelled` event.
- **Tool activity trail** under each answer showing each tool call as it starts, completes, or fails — previously `tool_start` and `tool_end` were silently discarded, so the UI looked frozen while tools ran.
- Keyboard send in the composer (Enter to send, Shift+Enter for a newline); the composer previously had no keyboard path to send at all.
- Copy buttons on messages and code blocks, a Retry last prompt action, and a confirmation before clearing a conversation.
- Inline `code` and **bold** now render in chat markdown instead of showing raw backticks and asterisks.
- `yodaman doctor` now runs a full runtime dependency health check — Ollama, Context Expert (`ctx`), Graphify, and OpenSpec — reporting version, resolved path, reachability, and the exact install command for anything missing. Supports `--json` for scripting and exits non-zero when degraded. The existing `yodaman doctor --graph` knowledge graph check is unchanged.
- New `DependencyDoctor` service backing the CLI report, with unit coverage for healthy, missing, and installed-but-unreachable states.
- `setup.sh` now verifies OpenSpec and installs `@fission-ai/openspec@latest` when it is absent, closing the last setup path that skipped a required dependency.
- OpenSpec now appears in the Electron startup diagnostics table with a one-click install action, matching the in-app health dashboard.
- `GET /api/health` now returns `degraded` and `pending` arrays naming exactly which checks need attention, so clients no longer have to diff the whole `checks` object.

### Changed
- Startup dependency checks in `server.js` are now driven by a single table instead of three near-identical blocks, and each check logs a structured `startup_dependency_ok` / `startup_dependency_missing` entry with version, path, and install hint.
- Startup now ends with a `startup_health_summary` log line listing degraded components and resolved versions, so a support log shows the whole dependency picture without correlating individual entries.
- Missing dependencies now log at `warn` rather than `error` — they degrade features but never stop startup, and the runtime log now distinguishes the two.
- Bumped the core app, VS Code extension, in-app chrome, website, manuals, and docs to `0.3.8`.

### Security
- **`sessions.json` is no longer tracked by git.** The file holds local chat history — 80 stored user and assistant messages across 33 workspace paths — and had been committed to the public `Yoda-Man/yodaman` repository across 8 commits. It is now git-ignored and removed from the index (the local file is untouched). `yodaman.db` is git-ignored explicitly rather than by coincidence, and a `RepositoryHygiene` test now fails if any user-data file becomes tracked or drops out of `.gitignore`. **Purging the existing history and treating the exposed content as public remains an outstanding manual step.**
- Resolved every advisory reported by `npm audit` — 2 critical (`shell-quote`, `tar`), 15 high (including `multer` DoS, `form-data` CRLF injection, `axios`, `undici`, `vite`, `postcss`, `js-yaml`, and the `electron-builder` toolchain), and 2 low. All fixes applied within the existing semver ranges, so no declared dependency changed. `npm audit` now reports 0 vulnerabilities.

### Fixed
- **The `ctx` install command pointed at a package that does not exist.** Install hints and the `POST /api/health/install` self-heal command used `@context-expert/cli`, which returns 404 from the npm registry; the published package is `@contextexpert/cli`. The "Install ctx CLI" button on the desktop diagnostics screen could therefore never succeed. Corrected in `DependencyChecker`, the self-heal endpoint, the status hint, and the website install snippet.
- Chat answers no longer include the `ctx` CLI startup banner and progress chatter (`◇ injected env …`, `Searching <project>…`). Source citations are preserved.
- Streamed chat messages are addressed by a stable id instead of an array index, so loading history mid-stream can no longer route the answer into the wrong bubble.
- A chat message can no longer be left stuck in the streaming state when the stream ends without a final answer.
- The "still working" hint after 10 seconds now actually appears; its timer was previously cleared one line after being set, making the feature dead code.
- The chat thread is no longer re-serialized to local storage on every streamed token.
- `GET /api/health` reported `status: "degraded"` on every request once startup finished, even when every dependency passed. It now reports `ok`, `degraded`, or `starting` based on the checks actually observed, so a genuine failure is no longer hidden behind a permanent warning.
- The Electron diagnostics table omitted OpenSpec from its polled `checkKeys`, so a missing OpenSpec install never surfaced on the recovery screen.
- `yodaman doctor` without `--graph` exited with a usage error instead of running any health check.
- The dependency report no longer renders Graphify's `installed` marker as the nonsensical version string `vinstalled`.

## [0.3.7] - 2026-07-12

### Added
- Holocron VR modal for launching the 3D constellation view from the main app.
- `AppErrorBoundary` around the renderer so a component crash surfaces a recoverable error instead of a blank window.
- Renderer safety coverage for error-boundary and crash-recovery behaviour.

### Changed
- Search now issues a shared search request with consistent error handling and recovery across the Chat and Search surfaces.
- Stardust separates change and spec listings and reports OpenSpec readiness and command outcomes.

### Fixed
- Stardust no longer drops the OpenSpec `specs` and `tools` options when forwarding commands to the CLI.

## [0.3.6] - 2026-07-08

### Added
- OpenSpec now appears in the in-app system health diagnostic table.

### Changed
- All tabs stay mounted when switching, so chat, search, graph results, dashboard, Stardust, and Plugins no longer reset.
- Chat history persists to local storage for instant restore across tab switches and app restarts.

### Fixed
- The search result `ExternalLink` action now toggles the expanded content view with the full file path and line info.

## [0.3.5] - 2026-07-05

### Added
- `VRViewer` and `UIPanel` frontend modules for 3D visualization and interactive UI controls.
- OpenSpec registered as a first-class dependency in `DependencyChecker`, including per-platform install hints.

### Changed
- Reworked `StardustWrapper` command handling and the Stardust panel layout.
- Search window reports request failures inline instead of silently returning no results.

## [0.3.4] - 2026-07-04

### Added
- **Project Stardust** — OpenSpec integration replacing the User Manual tab with a Stardust tab driving the propose → validate → apply → archive workflow.
- `StardustWrapper` backend service that spawns the `openspec` CLI as a child process, with live colour-coded stdout/stderr capture and structured result parsing.
- OpenSpec diagnostics panel with version check, project status, and one-click install.
- `@fission-ai/openspec` is now a required dependency (`npm install -g @fission-ai/openspec@latest`).

### Changed
- User manual, in-app manual, README, and website updated with OpenSpec setup instructions.
- Fresh macOS, Windows, and Linux desktop builds.

## [0.3.3] - 2026-06-27

### Changed
- Internal release build only — captured the startup chat, VR, and search design plans that shipped in `0.3.4`. No separate published changelog entry existed for this build.

## [0.3.2] - 2026-06-23

### Changed
- Health state types tightened across the runtime and REST layer.
- `SettingsProvider` reworked for editable runtime settings.
- Test suite refactored to resolve fixtures by relative path, removing machine-specific absolute paths.

## [0.3.1] - 2026-06-17

### Added
- System health monitoring dashboard (`HealthDashboard`, `HealthIndicator`, `useHealthCheck`) polling `/api/health`.
- Runtime dependency management: `DependencyChecker` locates Ollama, `ctx`, and Graphify across platform install locations and augments the Electron `PATH`.
- `POST /api/health/install` self-heal endpoint plus one-click install actions on the Electron recovery screen.
- `GitPanel` component with local commit history, heatmap, branch info, and commit diffs.
- Editable `ctx` configuration panel in the Dashboard.

### Changed
- Electron startup now shows a diagnostics dashboard that polls runtime health before loading the app.
- Consolidated legacy standalone docs into the README, user manual, and in-app manual.

## [0.3.0] - 2026-06-10

### Added
- Plugin architecture with `PluginAPI`, plugin manifests (`plugins/plugin.json`), and upload/validation support.
- New plugins: **CodeTrooper**, **Droid-Sweep**, **Grand-Inquisitor**, and **Lightsaber**.
- `fileUploadService` and `gitService` backend services.
- `AgentChatTab` — supervised agent chat with approvals.
- Voice agent bridge and voice command handling in the frontend.
- `FileUploader` frontend component.
- `yodaman create-plugin <name>` CLI scaffold generating source, tests, README entry, and config registration.
- Holocron VR website assets and a rebuilt landing page.

### Changed
- `ToolBox` and `AgentReasoningEngine` extended for plugin-provided tools and permission policy.

## [0.2.2] - 2026-06-02

### Added
- Graph Studio production hardening for async Graphify builds, persisted build status, artifact health, and large-graph fallbacks.
- `yodaman doctor --graph` for local Graphify graph health checks across configured workspaces.
- Project session history for Anchor and a version archive of the published package.

### Changed
- Bumped the core app, visible app chrome, manuals, docs, and VS Code extension package version to `0.2.2`.

### Fixed
- Graph search chat runtime reliability, workspace leak on repeated graph builds, and stale graph build state.
- Graph Studio mind map rendering and graph artifact loading inside the Graph Studio iframe.
- Search agent diagnostics and the Plugins tab documentation link.
- Website download links now track the published release artifacts.

## [0.2.1] - 2026-05-26

### Added
- Mandatory Graphify knowledge graph integration for workspace graph builds, graph-aware chat answers, and graph-aware agent context.
- Graphify plugin metadata, a required Graphify agent tool, and Graphify controls in the Plugins tab.
- Graphify REST endpoints for status, build, query, explain, and path operations.
- Default coding skill for Yoda-Agent with assumptions, simplicity, surgical edits, and verification guidance.

### Changed
- Reindexing now queues both Context Expert indexing and Graphify graph updates.
- Updated README, user manual, in-app manual, static manual, setup docs, configuration docs, runbooks, and API reference for Graphify and 0.2.1.
- Bumped the core app and VS Code extension package versions to `0.2.1`.

### Fixed
- Workspace refresh, stale workspace deletion, invalid-path reindex diagnostics, and Graphify protection from deletion.

## [0.1.9] - 2026-05-26

### Added
- Desktop runtime recovery screen with clear next steps instead of quitting when the local service cannot start.
- Runtime retry/restart flow for the desktop app while keeping the tray and menu available.
- Friendlier runtime-unavailable messages in the shared client, web chat, VS Code extension, and mobile app.

### Changed
- Desktop now opens a startup state first, attempts to start the managed runtime, then loads the app when the service is ready.
- VS Code commands now check runtime availability before ask/search/task/reindex actions and offer to start the configured runtime command.
- Mobile app now shows an inline runtime notice with pairing guidance when the configured runtime is unreachable.

### Fixed
- Shared client query-mode calls now target `/api/mode`.
- Desktop no longer exits immediately on startup service failures.

## [0.1.8] - 2026-05-26

### Added
- Query mode documentation and API reference for `code` and `doc` flows.
- Operational runbooks, configuration reference, asset license notes, CODEOWNERS, Dockerfile, and CI workflow.
- Structured request logging with request IDs and browser-visible `X-Request-Id` correlation.
- Unit and integration coverage for query classification, documentation preprocessing, search routing, and request validation.

### Changed
- Browser API client now validates non-2xx responses, parses structured error bodies, and applies configurable request timeouts.
- Runtime port and frontend API base can now be configured through environment variables.
- README now documents new capabilities, dependencies, health endpoints, and operations docs.

### Fixed
- Imported the pairing service in the REST controller so pairing-token enforcement and pairing endpoints work.
- Added validation for query mode, ask/session payloads, agent task payloads, and workspace paths.
- Added basic security headers to the Express runtime.

## [0.1.7] - 2026-05-19

### Added
- **SQLite Database Persistence**: Added Zero-Dependency local SQLite persistence (`yodaman.db`) for task history and system audit logs with automatic JSON fallback if unsupported.
- **Electron System Tray Controls**: Integrated custom System Tray menu with controls to show/hide the app, restart background daemon, copy pairing links, and quit.
- **Hierarchical Sidebar Tree View**: Redesigned VS Code extension sidebar with collapsible sections for Status & Info, Actions, and Recent Tasks.
- **API and UI Clearing Capabilities**: Added `DELETE /api/agent/tasks` and `DELETE /api/audit` API routes, client methods, and extension actions to purge history.
- **Task Detail Inspection**: Added `yodaman.viewTaskDetails` command in VS Code extension to print step-by-step logs and tool activities.
- **Integration Tests**: Added `tests/interfaces/RestController.test.js` to verify DELETE endpoint functionality, and expanded release smoke checks for Database.js integration.

## [Unreleased]

### Added
- Shared YodaMan API/SSE client, protocol constants, and TypeScript declaration files under `shared/`.
- Append-only local audit and task history logs via `audit-log.jsonl` and `task-history.jsonl`.
- Desktop native notifications for approval-needed and completed task transitions.
- Desktop folder picker for adding project workspaces.
- Mobile task event detail view.
- Release smoke check command: `npm run release:smoke`.

### Changed
- Updated roadmap, manuals, setup, API, desktop, mobile, security, publishing, and runtime protocol documentation for the new ecosystem phase.
- Mobile app now consumes the shared client through Metro workspace configuration.

## [0.1.6] - 2026-05-17

### Added
- Expanded automated coverage for patch application, audit ordering, approval rejection, malformed tool calls, and max-iteration handling.
- Release ignore rules for VS Code extension packages, mobile build output, and desktop client artifacts.

### Changed
- Bumped the core runtime, VS Code extension, and mobile app package versions to `0.1.6`.
- Refreshed website and documentation copy around the multi-client release flow and npm publish checks.

## [0.1.5] - 2026-05-14

### Added
- **Stress-Free Initialization**: Automated detection and notification for port conflicts to prevent "EADDRINUSE" crashes.
- **Robust CLI Sync**: Enhanced JSON extraction logic to handle decorative CLI banners and "dotenvx" noise, ensuring seamless project synchronization.

## [0.1.4] - 2026-05-14

### Added
- **Plugin Marketplace**: Dynamic tool extensibility with a user-friendly upload/delete GUI.
- **Session Persistence**: High-fidelity storage for chat history and agent reasoning steps.
- **Diff Approval**: Human-in-the-loop safety mechanism for autonomous file modifications.
- **Unit Tests**: Full test suite for Plugins and SessionStore infrastructure (15/15 passing).
- **Hot-Reloading**: Real-time engine updates when plugins are added or removed.

### Changed
- **Unified API**: Transitioned to query-parameter based routing for absolute project paths.
- **Manual v0.1.4**: Updated documentation to include Plugin and Safety guides.


## [0.1.3] - 2026-05-13


### Fixed
- **Robust CLI Parsing**: Improved JSON extraction logic to reliably filter out `dotenvx` banners and other CLI-injected strings during project synchronization.

## [0.1.2] - 2026-05-13

### Added
- **Auto-Discovery**: System now automatically detects and indexes projects added via  `context-expert` (ctx) CLI without requiring a restart.
- **Unified Ecosystem Logic**: Updated the core engine to support multi-project context and documentation simultaneously.
- **Premium Branding**: New Star Wars-inspired high-tech iconography (favicon and logo).
- **Expanded Documentation**: Improved README focusing on privacy and ecosystem-wide intelligence.

### Changed
- **Architecture Refactor**: Migrated from a monolithic `server.js` to a **Clean Architecture** with dedicated Services (`CliService`, `QueueService`, `WatcherService`) and API Routes.
- **Port Migration**: Moved default ports to `5190` (Frontend) and `3090` (Backend) to eliminate common development conflicts.
- **Frontend Modernization**: Centralized API interaction into a modular client and decoupled UI logic from state management.

### Fixed
- **CLI Parsing Robustness**: Implemented regex-based JSON extraction to prevent CLI header pollution from breaking the GUI.
- **Project Synchronization**: Fixed a mismatch between GUI project labels and CLI internal names.
- **Port Conflict Management**: Resolved an issue where ghost Node processes were blocking the dev server startup.

## [0.1.1] - 2026-05-12

### Added
- Initial support for `context-expert` (ctx) CLI integration.
- Glassmorphic UI design system.
- Background indexing queue.
