# Agent Tools and Approvals Specification

## Purpose
The agent acts on a workspace only through the tools in `backend/infrastructure/ToolBox.js`. `shared/toolCapabilities.js` decides which tool calls run freely and which stop at the approval gate, `awaitApproval` in `backend/core/AgentReasoningEngine.js`, where a person sees the diff, blast radius and covering specs before deciding. `scripts/approval-smoke.js` and `scripts/tools-smoke.js` are the release checks that exercise the gate and the real tools.

## Requirements

### Requirement: Tool dispatch
`callTool(name, parameters)` SHALL run a loaded plugin of that name first, after checking its permissions, then a ToolBox method of that name, and otherwise MUST throw `Tool not found: <name>`. Every call, successful or not, SHALL be recorded in the audit log.

#### Scenario: Successful call
- **WHEN** the agent calls `readFile`
- **THEN** an audit entry `{ type: "tool_call", tool: "readFile", status: "success", durationMs, parameters, resultSummary }` is recorded
- **AND** string `content`, `newContent` and `oldContent` are recorded as `[<n> chars]`, never as text

#### Scenario: Failed call
- **WHEN** a tool throws
- **THEN** an audit entry with `status: "error"` and the error message is recorded and the error is rethrown

#### Scenario: Unknown tool
- **WHEN** the agent calls a name that is neither a plugin nor a ToolBox method
- **THEN** the call throws `Tool not found: <name>`

### Requirement: Tool catalogue
`ToolBox.TOOL_SCHEMA` SHALL declare each built-in tool's name, typed parameters and one-line description. The system prompt SHALL render it, with the parameter conventions stated once, followed by every loaded plugin, each plugin description capped at 300 characters.

#### Scenario: Built-in tools
- **WHEN** the tool list is rendered
- **THEN** it contains `readFile`, `writeFile`, `applyPatch`, `executeCommand`, `searchCode`, `listFiles`, `impactOf`, `graphifyQuery`, `graphifyExplain`, `graphifyPath`, `graphifyAffected`, `specDrift`, `specPropose`, `specDraft`, `specValidate` and `specArchive`, numbered, each as `name(param: type, optional?: type (note))`

#### Scenario: Compact list
- **WHEN** the compact prompt is used
- **THEN** `getBriefToolDefinitions()` lists every built-in and plugin tool as `name(params)` on one comma-separated line, with no descriptions

### Requirement: Read-only tools and gated tools
A built-in tool SHALL run without asking only when it is on `READ_ONLY_TOOLS`; every other built-in name MUST require approval, so a new tool is gated until declared safe. A plugin with a non-empty permission list SHALL require approval when any permission is in `MUTATING_PERMISSIONS`.

#### Scenario: Read-only list
- **WHEN** `requiresApproval` is asked about `readFile`, `listFiles`, `searchCode`, `searchCodeFilesystem`, `impactOf`, `graphifyQuery`, `graphifyExplain`, `graphifyPath`, `graphifyAffected`, `specDrift`, `specDraft` or `specValidate`
- **THEN** it returns false

#### Scenario: Gated built-ins
- **WHEN** it is asked about `writeFile`, `applyPatch`, `executeCommand`, `specPropose`, `specInit`, `specArchive` or any unlisted name
- **THEN** it returns true

#### Scenario: Plugins
- **WHEN** a plugin declares `write`, `unrestricted`, `command`, `audit:write`, `agent:invoke`, `task:create` or `filesystem:write`
- **THEN** its calls need approval, while a plugin declaring only `read`, `search` or `network` runs without asking
- **AND** permissions are compared by exact membership, never by substring

### Requirement: Workspace sandbox
Every path a tool touches SHALL resolve inside an allowed root: the runtime's working directory, each `watchedDirectories` entry in the YodaMan config file, roots added with `setExtraAllowedRoots`, and the system temp folder when `NODE_ENV=test`. Symlinks MUST be resolved before the containment check.

#### Scenario: Relative path
- **WHEN** a relative path does not exist under the working directory
- **THEN** each allowed root is tried in turn and the first existing match is used

#### Scenario: Escape attempt
- **WHEN** a path, or a symlink inside a workspace, resolves outside every allowed root
- **THEN** the tool throws `Path is outside allowed workspaces: <path>`

#### Scenario: New file
- **WHEN** `writeFile` targets a file that does not exist yet
- **THEN** containment is checked on the nearest existing parent with the missing tail appended

### Requirement: File tools
`readFile` SHALL return `{ content }`. `writeFile` SHALL create missing parent folders and replace the whole file. `applyPatch` SHALL replace `oldText` with `newText` only when `oldText` occurs exactly once.

#### Scenario: Missing file
- **WHEN** `readFile` or `applyPatch` names a file that does not exist
- **THEN** it throws `File not found: <filePath>`

#### Scenario: Patch does not match once
- **WHEN** `oldText` is absent, occurs more than once, or either text is not a string
- **THEN** `applyPatch` throws `Patch failed: oldText was not found`, `Patch failed: oldText matched more than once`, or `oldText and newText are required`

#### Scenario: Successful edits
- **WHEN** a write or patch succeeds
- **THEN** it returns `{ message: "Successfully wrote to <filePath>" }` or `{ message: "Successfully patched <filePath>" }`

### Requirement: Command policy
`executeCommand` SHALL run one allowlisted executable with `execFile`, never through a shell, with a 120-second timeout, and only when the `allowAgentCommands` setting is on. It MUST reject shell operators, paths as the executable, inline-eval flags and the legacy denylist patterns.

#### Scenario: Allowed command
- **WHEN** the command is `npm test` and commands are enabled
- **THEN** it returns `{ stdout, stderr, exitCode }`, and a missing executable returns `exitCode: 127` with `Command not found: <bin>`

#### Scenario: Blocked command
- **WHEN** the command contains `; & | $ > <`, a backtick or a newline
- **THEN** it throws ``Command blocked by policy: shell operators (; & | ` $ > <) are not permitted. Run one command at a time.``
- **AND** `rm`, `/tmp/x` and `node -e ...` are refused as not allowlisted, a path, or `executes inline source`

#### Scenario: Working directory
- **WHEN** the model calls `executeCommand` without `cwd` while a workspace is selected
- **THEN** the engine sets `cwd` to the active workspace before the approval, so the reviewer sees where it will run; with no workspace selected it runs in the runtime's working directory

#### Scenario: Commands disabled
- **WHEN** `allowAgentCommands` is false, the default
- **THEN** it throws `Agent shell commands are disabled. Enable in Settings.`

#### Scenario: Allowlist
- **WHEN** the allowlist is read
- **THEN** it holds `git`, `node`, `npm`, `npx`, `yarn`, `pnpm`, `jest`, `tsc`, `eslint`, `prettier`, `vite`, `python`, `python3`, `pip`, `pip3`, `pytest`, `make`, `cargo`, `go`, `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `diff`, `stat`, `file`, `echo`, `pwd`, `which`, `sort`, `uniq`, `tree`, `du`, `df` and `date`, plus any names in the `allowedCommands` setting

### Requirement: Search and graph tools
`searchCode` SHALL run the shared search pipeline in `unified` mode, so the agent searches with Context Expert, Graphify ranking and OpenSpec tagging like every other view. Its `top` SHALL default to 15 and be capped at 50, and the query MUST reach `ctx search` after `--`. `impactOf` and the `graphify*` tools SHALL read the workspace's knowledge graph, defaulting `project` to the runtime's working directory.

#### Scenario: Query that looks like a flag
- **WHEN** the agent searches for `-k 3`
- **THEN** ctx is run as `ctx search [-p <name>] [-k <n>] --json -- "-k 3"`, every option before the `--`, so the query is searched for rather than read as a flag

#### Scenario: Impact of a file
- **WHEN** the agent calls `impactOf({ file, project, depth })`
- **THEN** it gets `risk`, `stale`, `dependentCount`, up to 5 `dependents`, `testCount`, up to 5 `coveringTests`, `specCount`, `describedBy` and an `advice` line, with `depth` clamped to 1 through 4, default 2

#### Scenario: File not in the graph
- **WHEN** the graph has no node for the file
- **THEN** `impactOf` returns `available: false`, the reason, and `Proceed with care: the graph cannot confirm what depends on this file.`

#### Scenario: Missing file argument
- **WHEN** `impactOf` has no `file`
- **THEN** it throws `file is required — the workspace-relative path you intend to edit`

### Requirement: OpenSpec tools
The agent SHALL reach OpenSpec through `specDrift`, `specDraft`, `specPropose`, `specInit`, `specValidate` and `specArchive`. `specPropose` MUST NOT overwrite existing files, and `specDraft` MUST write nothing.

#### Scenario: Propose a change
- **WHEN** the agent calls `specPropose({ changeName: "add-dark-mode" })`
- **THEN** `openspec/changes/add-dark-mode/` gets `proposal.md`, `design.md` and `tasks.md` where they are missing
- **AND** a name with `/`, `\` or `..` throws `changeName must not contain path separators or ".."`

#### Scenario: Validate and archive
- **WHEN** the agent calls `specValidate` or `specArchive` with a `changeName`
- **THEN** `openspec validate <name>` or `openspec archive <name>` runs in the workspace and the result has `success`, `output`, `errors` and a message such as `Change "<name>" passed validation.`

#### Scenario: Initialize
- **WHEN** `specInit` runs
- **THEN** it runs `openspec init <workspace> --tools none --force`, and a failure throws `openspec init failed: <output>`

### Requirement: Plugin permissions
A plugin's permissions SHALL be lower-cased, de-duplicated and checked against a closed allowlist on load and before every call. A plugin that declares no permissions MUST be treated as `unrestricted`, and an unrestricted plugin MUST NOT run unless the `allowUnrestrictedPlugins` setting is on.

#### Scenario: Unsupported permission
- **WHEN** a plugin declares a permission outside the allowlist
- **THEN** it is refused with `Plugin <name> declares unsupported permissions: <list>`

#### Scenario: Unrestricted plugin
- **WHEN** an unrestricted plugin is called while `allowUnrestrictedPlugins` is false
- **THEN** the call throws `Plugin <name> is unrestricted. Enable in Settings.`

#### Scenario: Workspace parameter filled in
- **WHEN** the model calls a plugin that declares `workspacePath`, `projectPath` or `projectRoot` and leaves it empty
- **THEN** the engine fills it with the active workspace after approval and before the call

### Requirement: Approval gate
Every tool call that needs approval SHALL pass through `awaitApproval`, the single gate for model-requested and directly routed writes. The task MUST pause with status `awaiting_approval` and emit an `awaiting_approval` event, and the tool MUST NOT run until a decision arrives.

#### Scenario: Write proposed
- **WHEN** the model asks for `writeFile` or `applyPatch`
- **THEN** the event carries `tool`, `taskId`, `params: { filePath, oldContent, newContent }`, `impact` and `specImpact`
- **AND** the same object is stored as the task's `pendingApproval`

#### Scenario: Call with no file
- **WHEN** the gated tool names no file, such as `executeCommand` or `specInit`
- **THEN** `params.arguments` carries the sanitized parameters, `impact` is `{ available: false, reason: "not a file edit" }`

#### Scenario: Gate proven on disk
- **WHEN** a write is pending
- **THEN** the target file is unchanged until the decision is approved

### Requirement: Diff preview
The approval SHALL show what the file will contain if approved, not just the arguments. For `writeFile` the new content SHALL be `content`; for `applyPatch` it SHALL be the old content with the single occurrence of `oldText` replaced, and MUST be `null` when that cannot be predicted.

#### Scenario: Patch preview
- **WHEN** `oldText` occurs exactly once in the current file
- **THEN** `newContent` is exactly what `applyPatch` would write

#### Scenario: Unpredictable patch
- **WHEN** `oldText` occurs zero or several times
- **THEN** `newContent` is `null` rather than a guessed diff

#### Scenario: Chat card
- **WHEN** Chat receives `awaiting_approval`
- **THEN** it shows `Approval required — <tool>`, the blast radius, a line diff with added and removed counts, `[New file]` when there was no old content, and the buttons `Approve change` and `Reject`

### Requirement: Blast radius
When a workspace is selected and the call names a file, the gate SHALL attach the file's graph impact: dependents within 2 hops, covering tests, risk and staleness. It SHALL also report which specs cite the file.

#### Scenario: Risk levels
- **WHEN** impact is computed
- **THEN** risk is `low` with no dependents, `high` with 5 or more dependents and no tests, `moderate` with fewer and no tests, and with tests `moderate` from 12 dependents and `low` below that

#### Scenario: No workspace or graph
- **WHEN** no workspace is selected, or the graph does not exist or lacks the file
- **THEN** `impact` is `available: false` with `no workspace selected`, `no graph has been built for this workspace yet`, or `file is not represented in the graph`

#### Scenario: Spec impact
- **WHEN** a workspace is selected
- **THEN** `specImpact` is `{ available: true, specCount, mentionedIn }`, and without a workspace it is `{ available: false, reason: "no projectId" }`

#### Scenario: Spec references match whole path segments
- **WHEN** one spec cites `logger.js` and another `src/my-app/auditlogger.js`, and the gated call edits `src/my-app/auditlogger.js` in the workspace
- **THEN** `mentionedIn` lists only the second: a reference names a file when the two are equal or one ends with `/` followed by the other

### Requirement: Approval decision
`POST /api/agent/approve` SHALL deliver a decision to the waiting task. An approved call SHALL run and the task SHALL return to `running`. A rejected call MUST NOT run, and the model SHALL be told `User rejected this change.`

#### Scenario: Approve
- **WHEN** a client posts `{ "taskId": "<id>", "approved": true }`
- **THEN** the tool runs and the server returns `{ "message": "Signal sent" }`

#### Scenario: Reject
- **WHEN** `approved` is false
- **THEN** the engine emits `tool_end` with `result: { error: "User rejected this change." }`, the task continues with status `running`, and a rejected draft spec is listed as `rejected, not written`

#### Scenario: Only a real true approves
- **WHEN** `approved` is anything other than the JSON boolean `true`, such as the string `"false"`, `1` or missing
- **THEN** the decision counts as a rejection, exactly as `false` does, and the tool does not run

#### Scenario: Missing task id
- **WHEN** the body has no `taskId`
- **THEN** the server answers 400 with `{ "error": "taskId is required", "code": "invalid_task_id" }`, and an unknown task id still returns `Signal sent` and changes nothing

#### Scenario: Pending approvals
- **WHEN** a client calls `GET /api/agent/pending-approvals`
- **THEN** it gets every task with a pending approval as `{ taskId, task, projectId, createdAt, updatedAt, approval }`, newest first

### Requirement: Release checks for tools and approvals
`npm run test:approval` (`scripts/approval-smoke.js`) SHALL drive the real agent and prove a write pauses and a rejection leaves the file untouched. `npm run test:tools` (`scripts/tools-smoke.js`) SHALL prove `ctx`, `graphify`, `openspec` and `ollama` start and that Graphify builds a real graph. Both MUST exit 1 on failure.

#### Scenario: Approval smoke
- **WHEN** Ollama answers at `127.0.0.1:11434` and an indexed, non-temporary workspace exists
- **THEN** the script starts `server.js` on port 3097 (or `YODAMAN_SMOKE_PORT`, or uses `YODAMAN_SMOKE_URL`), asks the agent to replace `.yodaman-approval-smoke/sentinel.txt`, rejects the proposal, and checks the file at the pause and after rejection

#### Scenario: Write escapes the gate
- **WHEN** the sentinel file changed without an approved decision
- **THEN** the script prints `APPROVAL GATE FAILED — the file changed without an approved decision.` and exits 1 without retrying

#### Scenario: Not exercised
- **WHEN** the agent never proposes a write after 3 attempts
- **THEN** the run is INCONCLUSIVE: it fails when the tool was named in the task, and is reported without failing when the model chose the tool
- **AND** a missing Ollama or indexed workspace prints `SKIP:` and exits 0

#### Scenario: Tools smoke
- **WHEN** a required tool is missing or the sample project's graph has no nodes
- **THEN** the script prints `Tools smoke FAILED: <reason>` and exits 1, and otherwise prints `Tools smoke passed.`
