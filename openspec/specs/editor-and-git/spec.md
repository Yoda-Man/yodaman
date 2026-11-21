# Editor and Git Specification

## Purpose
YodaMan opens workspace files in the user's own editor and reads and changes Git state for a workspace. The editor hand-off lives in `backend/infrastructure/EditorLauncher.js` and `backend/interfaces/routes/editorRoutes.js` (`/api/editor/*`), with the choice stored in the `editorCommand` setting. Git lives in `backend/interfaces/routes/gitRoutes.js` (`/api/git/*`), `backend/services/gitService.js` (reads, through simple-git) and `backend/interfaces/support/git.js` (`runGit`, `readGitContext`). `src/components/GitPanel.jsx` is the Git panel in the UI.

## Requirements

### Requirement: Editor choice follows the OS and accepts any command
The `editorCommand` setting SHALL decide which program opens a file and MUST NOT default to any named editor. Empty or `system` (the default) SHALL use the OS default application; a value ending in `.app` SHALL use that macOS app; any other value SHALL be a command template.

#### Scenario: System default on macOS
- **WHEN** `editorCommand` is empty and a file is opened on macOS
- **THEN** the default app for that file is asked from Launch Services through `osascript -l JavaScript`, with the path passed as an argument
- **AND** if none is found the file is opened with `open <file>`

#### Scenario: System default elsewhere
- **WHEN** `editorCommand` is empty on Windows or Linux
- **THEN** the file is opened with `explorer.exe <file>` or `xdg-open <file>`, and the line is not used

#### Scenario: App bundle
- **WHEN** `editorCommand` is `/Applications/Zed.app`
- **THEN** that app is used, and a value with a space before `{` is treated as a template instead

### Requirement: Opening at the line from an app
For a macOS app, chosen or default, the launcher SHALL use a command line found inside the bundle so the file opens at the line, and otherwise SHALL run `open -a <app> <file>` without the line. Recognition MUST be by bundle layout, not by app name.

#### Scenario: VS Code family
- **WHEN** the app has an extensionless, non-tunnel executable in `Contents/Resources/app/bin`
- **THEN** it is run with `-g <file>:<line>`, or `<file>` with no line

#### Scenario: Zed and Sublime Text
- **WHEN** the app has `Contents/MacOS/cli` or `Contents/SharedSupport/bin/subl`
- **THEN** it is run with `<file>:<line>`, or `<file>` with no line

### Requirement: Command templates
A template SHALL be split into arguments like a shell (whitespace separates, single and double quotes group, backslash escapes inside double quotes) but MUST NOT be run through a shell. `{file}`, `{line}` and `{column}` SHALL be substituted inside each argument after splitting.

#### Scenario: Substitution
- **WHEN** the template is `idea --line {line} {file}` and line 12 of `/w/a b.js` is opened
- **THEN** `idea` is spawned with arguments `--line`, `12`, `/w/a b.js`

#### Scenario: No file placeholder
- **WHEN** the template has no `{file}`
- **THEN** the file is appended as the last argument

#### Scenario: Defaults
- **WHEN** no line is given
- **THEN** `{line}` and `{column}` become `1`, and `{column}` is always `1` from the open route

### Requirement: Editor setting validation
Saving `editorCommand` through `PUT /api/settings` SHALL be allowed only from this computer and MUST reject a value that cannot launch anything. `system` SHALL be stored as an empty string.

#### Scenario: Remote change refused
- **WHEN** a non-local caller sends `PUT /api/settings` with `editorCommand`
- **THEN** the route's local-only guard answers 403 `Settings can only be changed from this computer` with code `settings_local_only` before the editor check runs

#### Scenario: Invalid values
- **WHEN** the value is not text, longer than 1000 characters, contains a newline, carriage return or NUL, is empty after splitting, or has an unclosed quote
- **THEN** the answer is 400 with code `invalid_settings` and one of `The editor must be text`, `The editor command must be 1000 characters or fewer`, `The editor command must be a single line`, `The editor command is empty` or `The editor command has an unclosed quote`

### Requirement: Open a file in the editor
`POST /api/editor/open` with `{ workspace, path, line }` SHALL launch the configured editor on a file inside a registered workspace and answer once the process has started. It MUST be refused for non-local callers, and the program MUST come from settings or the OS, never the request.

#### Scenario: Opened
- **WHEN** a local caller opens `src/a.js` at line 10 in a registered workspace
- **THEN** the answer is `{ opened: true, file, line, editor, atLine }` where `file` is the real path and `atLine` says whether the line was passed to the editor

#### Scenario: Remote caller
- **WHEN** the request is not from 127.0.0.1 or ::1
- **THEN** the answer is 403 `Files can only be opened from this computer` with code `editor_local_only`

#### Scenario: Launch failure
- **WHEN** the editor program cannot be started
- **THEN** the answer is 500 `Could not start <editor>: <reason>` with code `editor_launch_failed`

#### Scenario: Detached
- **WHEN** the editor starts
- **THEN** it is spawned detached with stdio ignored and unreferenced, so it outlives the request and the runtime

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

### Requirement: File preview
`GET /api/editor/preview?workspace&path&line` SHALL return up to 40 lines of a text file starting at `line` (default 1), each cut to 400 characters, under the same containment as open. Unlike open, it SHALL also serve paired remote callers.

#### Scenario: Preview
- **WHEN** a caller previews a 100-line file from line 90
- **THEN** the answer is `{ file, startLine: 90, totalLines, lines }` with the remaining lines

#### Scenario: Too large or binary
- **WHEN** the file is over 1 MB
- **THEN** the answer is 413 `File is too large to preview` with code `preview_too_large`
- **AND** a NUL byte in the first 8192 bytes gives 415 `Binary file; nothing to preview` with code `preview_binary`

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

### Requirement: Git context
`GET /api/git/context?path` SHALL return `{ branch, ahead, behind, recentCommits }` for a folder, with the last 8 commits as `{ hash, subject, relativeTime }`. A Git failure SHALL still answer 200 with a placeholder.

#### Scenario: Not a repository
- **WHEN** the folder is not a Git repository
- **THEN** the answer is 200 `{ branch: "Unavailable", ahead: 0, behind: 0, recentCommits: [], error }`

#### Scenario: No commits yet
- **WHEN** the repository has no commits
- **THEN** the branch is still reported and `recentCommits` is empty

#### Scenario: Missing path
- **WHEN** `path` is missing
- **THEN** the answer is 400 `path must be a non-empty string` with code `invalid_request`

### Requirement: Git history and commit detail
`GET /api/git/history?path&file&limit` SHALL return `{ commits }`, each `{ hash, author, date, message, filesChanged }`, newest first, `limit` clamped to 1..500 (default 100). `GET /api/git/commit?path&hash` SHALL return `{ hash, author, date, message, files }`, each file `{ filePath, additions, deletions }`.

#### Scenario: File outside workspace
- **WHEN** `file` resolves outside `path`
- **THEN** the answer is 400 `filePath must be inside workspacePath` with code `git_history_failed`

#### Scenario: Bad hash
- **WHEN** `hash` is not 7 to 40 hex characters
- **THEN** the answer is 400 `commitHash must be a git hash` with code `git_commit_failed`

#### Scenario: Binary file in a commit
- **WHEN** a commit changes a binary file
- **THEN** that file's `additions` and `deletions` are `null`

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

### Requirement: Git panel
The Git panel SHALL show the selected workspace's branch, ahead and behind counts and recent commits from `/api/git/context`, and offer Commit, Push, Pull and a new-branch field. Each action SHALL post `{ path, ... }` and show `✓ Done` or `✗ <error>` for 3 seconds, reloading the context after success.

#### Scenario: Default message
- **WHEN** the user clicks Commit with an empty message field
- **THEN** the panel commits all changes with the message `yodaman update`

#### Scenario: New branch
- **WHEN** the new-branch field is empty
- **THEN** the Branch button is disabled
