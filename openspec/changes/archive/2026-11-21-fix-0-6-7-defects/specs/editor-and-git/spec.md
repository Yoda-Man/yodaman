## MODIFIED Requirements

### Requirement: Workspace file containment
The editor routes SHALL resolve `path` against the registered `workspace` (relative paths may start with `./`) and follow symlinks for both, and MUST refuse a file whose real path is outside the workspace's real path.

#### Scenario: Unregistered workspace
- **WHEN** `workspace` is not in config `watchedDirectories`
- **THEN** the answer is 404 `Workspace is not registered: <path>` with code `workspace_not_registered`

#### Scenario: Escapes and bad input
- **WHEN** the file resolves outside the workspace
- **THEN** the answer is 403 `File is outside the workspace` with code `file_outside_workspace`
- **AND** a missing file gives 404 `File not found: <path>` (`file_missing`), a folder gives 400 `Not a file: <path>` (`not_a_file`), and a NUL in the path gives 400 `path cannot contain null bytes` (`invalid_path`)

#### Scenario: Bad line
- **WHEN** `line` is present but not a whole number from 1 to 10000000
- **THEN** the answer is 400 `line must be a positive whole number` with code `invalid_line`

### Requirement: Editor options
`GET /api/editor/options` SHALL answer local callers with `{ editorCommand, systemDefault, detected, placeholders }`, where `detected` lists editors found on this machine as suggestions only, each `{ name, setting, atLine: true }`.

#### Scenario: Detection
- **WHEN** options are requested on macOS
- **THEN** apps in `/Applications` and `~/Applications` with a recognised bundled command line are listed with the app path as `setting`
- **AND** editors on PATH from a fixed list (for example `code`, `zed`, `idea`, `emacsclient`) are listed with a template such as `code -g {file}:{line}`

#### Scenario: Each editor listed once
- **WHEN** an app and a PATH command have the same display name, such as `Zed.app` and `zed`
- **THEN** the editor is listed once, with the app path as `setting`

#### Scenario: Placeholders and default
- **WHEN** options are returned
- **THEN** `placeholders` is `["{file}", "{line}", "{column}"]` and `systemDefault` is the OS default app's name for a `.js` file, or `null`

#### Scenario: Remote caller
- **WHEN** a non-local caller requests options
- **THEN** the answer is 403 `Editor settings are only available on this computer` with code `editor_local_only`

### Requirement: Git subprocess safety
Git commands in the routes SHALL run through `runGit`, which uses `execFile('git', args)` in the given folder with a 5 second timeout and never a shell. On failure the error message MUST be git's trimmed stderr when there is one.

#### Scenario: Message from stderr
- **WHEN** `git push` fails with `fatal: no upstream`
- **THEN** the rejected error's message is `fatal: no upstream`

### Requirement: Git heatmap, timeline and branch
`GET /api/git/heatmap?path` SHALL return `{ files }` changed in the last 30 days, each `{ filePath, changeCount, lastChangeDate, authorCount }`, most changed first. `GET /api/git/timeline?path&days` SHALL return `{ commits, truncated }` oldest first. `GET /api/git/branch?path` SHALL return `{ currentBranch, branches, ahead, behind, latestCommit }`.

#### Scenario: Timeline bounds
- **WHEN** the timeline is read
- **THEN** `days` is clamped to 1..3650 (default 365), at most 3000 commits are read, and only commits touching the workspace folder are kept, with paths relative to it
- **AND** each commit is `{ hash (10 chars), author, date, files: [{ path, status }] }` and `truncated` is true when the limit was hit

#### Scenario: Branch ahead and behind
- **WHEN** `GET /api/git/branch` answers
- **THEN** `ahead` and `behind` count the commits only on the current branch and only on its upstream, from `git rev-list --left-right --count HEAD...@{upstream}`
- **AND** both are `0` when the branch has no upstream, and `latestCommit` is `null` in a repository with no commits

#### Scenario: Read failure
- **WHEN** a read route fails
- **THEN** the answer is the error's status (500 by default) with code `git_heatmap_failed`, `git_timeline_failed` or `git_branch_failed`

### Requirement: Git mutations
`POST /api/git/commit` with `{ path, message, files }` SHALL run `git add -- <files>` (default `["."]`) and `git commit -m <message>`, answering `{ ok: true, branch, hash }` with a 7-character hash. Push SHALL run `git push`, pull `git pull --rebase`, and branch `git checkout -b <branch>`. `path` MUST be a registered workspace, and no request value MAY be read as a git option.

#### Scenario: Unregistered folder
- **WHEN** `path` is not a registered workspace
- **THEN** the answer is 404 `{ ok: false, error: "Workspace is not registered: <path>", code: "workspace_not_registered" }` and git is not run

#### Scenario: Values that look like options
- **WHEN** a `files` entry starts with `-`, such as `-A`
- **THEN** it is staged as a path, because the files follow `--`
- **AND** a `branch` starting with `-` is refused with 400 `branch must not start with "-"` and code `invalid_request`

#### Scenario: Missing or bad field
- **WHEN** `path`, `message` or `branch` is missing, or `files` is not a non-empty array of strings
- **THEN** the answer is 400 `{ ok: false, error, code: "invalid_request" }`, for example `message must be a non-empty string`

#### Scenario: Nothing to commit
- **WHEN** the commit fails, for example because nothing changed
- **THEN** no commit is made and the answer is 500 with git's message (such as `nothing to commit, working tree clean`) and code `git_commit_failed`

#### Scenario: Push and pull output
- **WHEN** push or pull succeeds
- **THEN** the answer is `{ ok: true, output }` with git's trimmed stdout

#### Scenario: Push and pull time limit
- **WHEN** push or pull runs
- **THEN** it may take up to 10 minutes, while every other git command is stopped after 5 seconds
- **AND** git is run with `GIT_TERMINAL_PROMPT=0`, so a remote that needs a password fails at once instead of waiting for one

#### Scenario: Git failure
- **WHEN** git fails
- **THEN** the answer is 500 `{ ok: false, error, code }` with git's message and code `git_commit_failed`, `git_push_failed`, `git_pull_failed` or `git_branch_failed`
