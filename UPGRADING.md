# Upgrading and uninstalling

## Upgrading

**No migration is needed anywhere in 0.5.x.** Upgrade in place:

```bash
npm install -g yodaman@latest
```

If you use the desktop app, download the new `.dmg` or `.AppImage` and replace
the old one. If you run from source, `git pull && npm install`.

Restart the runtime afterwards so the new version is the one serving requests.
Anything connected over MCP picks up the new server the next time it spawns it;
no client configuration changes between 0.5.x versions.

### Do I need to re-index?

**No.** There is no index or graph schema version, and nothing about the on-disk
formats changed across 0.5.x — your existing index stays valid.

One exception, worth doing once if it applies to you:

> **If you first indexed with 0.5.0 or earlier**, that version indexed YodaMan's
> own generated `.yodaman-doc-chunks` directory as if it were your documentation.
> The fix landed in 0.5.1. Existing entries are not removed retroactively, so a
> rebuild clears them out and slightly improves search results. Delete
> `.yodaman-doc-chunks/` and `graphify-out/` from the workspace and re-index.

### If something looks wrong after upgrading

Force a clean rebuild of a single workspace by deleting its generated
directories and re-indexing:

```bash
rm -rf .yodaman-doc-chunks graphify-out
```

Both are regenerated. Neither contains anything you wrote — see the table below
for what is generated versus what is yours.

## Uninstalling

YodaMan is local-first, so removing it is a matter of deleting files. Nothing
was uploaded anywhere and there is no account to close.

### 1. Remove the program

```bash
npm uninstall -g yodaman
```

For the desktop app, delete `YodaMan.app` (macOS) or the `.AppImage` (Linux).

This also removes the runtime's own state, which lives inside the install
directory: `config.json`, `sessions.json`, `audit-log.json`,
`audit-log.jsonl`, `task-history.json`, and `task-history.jsonl`.

### 2. Remove state kept outside the install directory

| Location | What it is |
| --- | --- |
| `~/.yodaman/logs` | Runtime logs. The whole `~/.yodaman` directory can go. |
| `<workspace>/.yodaman-doc-chunks/` | Generated document chunks, one directory per indexed workspace. |
| `<workspace>/graphify-out/` | Graphify's knowledge graph and AST cache, one per indexed workspace. |

```bash
rm -rf ~/.yodaman
```

Then, in each workspace you indexed:

```bash
rm -rf .yodaman-doc-chunks graphify-out
```

If you set a custom `YODAMAN_LOG_DIR` or `YODAMAN_CONFIG_PATH`, remove those
locations too.

### 3. macOS only — if you changed the Ollama context length from YodaMan

That setting edits Ollama's launchd service, and YodaMan keeps a backup of the
original next to it:

```
~/Library/LaunchAgents/homebrew.mxcl.ollama.plist.yodaman-backup
```

To restore Ollama to how it was before YodaMan touched it, move that backup back
over `homebrew.mxcl.ollama.plist` and restart the service. If you never changed
the context length from inside YodaMan, this file will not exist.

### 4. Disconnect it from your other agents

Remove the `yodaman` entry from any MCP client you configured.
`docs/guides/mcp.md` lists where each client keeps that file — for Claude Code:

```bash
claude mcp remove yodaman
```

### What is *not* YodaMan's to delete

**`openspec/`** in your workspace holds specs **you** wrote. YodaMan reads it and
never generates it. Leave it alone unless you no longer want your own specs.

Your source code is untouched throughout. YodaMan only ever writes to the
generated directories listed above, and to files you explicitly approved through
the approval gate.
