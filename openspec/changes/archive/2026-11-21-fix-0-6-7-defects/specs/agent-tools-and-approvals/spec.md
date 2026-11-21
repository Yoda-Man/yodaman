## MODIFIED Requirements

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
- **WHEN** one spec cites `Logger.js` and another `src/AuditLogger.js`, and the gated call edits `<workspace>/src/AuditLogger.js`
- **THEN** `mentionedIn` lists only the second: a reference names a file when the two are equal or one ends with `/` followed by the other
