# Dead code: what is safe to delete, and what only looks safe

Read this before deleting any file that "nothing imports".

YodaMan reaches a lot of its own code without a static import: plugins are
`require()`d from a computed path, plugin UI components are named as strings in a
JSON manifest, and several files are entry points launched by a host (Electron,
VS Code, Expo, npm) rather than imported by us. Every tool that builds an import
graph — `knip`, IDE "unused file" hints, bundler tree-shaking, and any
basename-matching scan — is blind to all of it.

This is not hypothetical. An unconfigured `knip` run against this repository
reported **24 unused files. Nineteen were false positives**, including every
shipped plugin. Acting on that report would have deleted working features while
leaving the test suite green, because the plugin tests also `require()` by path.

## Run the checks correctly

A `knip.json` now lives at the repository root and declares the real entry
points. Use it:

```bash
npx knip
```

Without that config, `knip` sees only `package.json` `main` (`server.js`) and
reports most of the codebase as dead. If you add a new entry point — a script, a
plugin directory, another host-launched file — add it to `knip.json` too.

To confirm which plugins are actually live, ask the loader rather than the import
graph:

```bash
node -e "const t=require('./backend/infrastructure/ToolBox');console.log([...t.plugins.keys()])"
```

Anything in that list is running. There is no static reference to any of it.

## Files that look unused and are not

Each of these carries a `LOAD-BEARING` header comment explaining the same thing
in place. List them with:

```bash
git grep -l "LOAD-BEARING"
```

Use `git grep`, not `grep -r`. Some `grep` builds on developer machines are
actually `ugrep`, which skips ignore-file paths when recursing and will silently
omit results — `git grep` behaves the same everywhere.

| File | How it is actually reached |
|---|---|
| `plugins/CodeTrooper.js`, `Droid-Sweep.js`, `Grand-Inquisitor.js`, `graphify.js`, `lightsaber.js` | `ToolBox.loadPlugins()` does `readdirSync()` then `require(pluginPath)` — a computed path, never a literal |
| `plugins/main.js` | Holocron VR entry, declared as `"entry": "main.js"` in `plugins/plugin.json` |
| `frontend/UIPanel.js` | Named as a **string** in `plugins/plugin.json` → `uiExtensions[].component`, and in `plugins/main.js` → `registerPluginCard({ component: ... })` |
| `frontend/VRViewer.js` | Opened by string path from `UIPanel.js` → `openModal({ component: './frontend/VRViewer.js' })` |
| `electron/main.js` | `npm run desktop`, and `electron-builder.json` → `extraMetadata.main` |
| `electron/preload.js` | `path.join(__dirname, 'preload.js')` inside `electron/main.js` |
| `extensions/vscode-yodaman/src/extension.js` | `"main"` in the extension's own `package.json`; VS Code loads it |
| `apps/mobile/App.js` | Expo/React Native entry, resolved by convention. Note `apps/mobile/` is gitignored and untracked, so it will not appear in `git grep` output |
| `bin/yodaman.js` | `"bin"` field in `package.json`; npm resolves it by name |
| `shared/yodamanClient.js`, `yodamanClient.d.ts` | Published API. Imported from *outside* the package: the VS Code extension and the mobile app. `scripts/release-smoke.js` gates the release on it |
| `shared/yodamanProtocol.js`, `yodamanProtocol.d.ts` | **Generated** by `scripts/generate-protocol.js`; required by `yodamanClient.js`; byte-compared by `Protocol.test.js` |
| `tests/fixtures/codetrooper-files/*` | Input **data**, not code. `CodeTrooper.test.js` asserts the directory holds exactly 4 files (2 JS, 1 CSS, 1 MD) — adding or removing any file breaks three tests |

## Exports that look unused and are not

- **`GraphFacts.orphanFiles` / `coverageByFile`** — no caller in `backend/` or
  `src/`. Their only consumers are `plugins/Droid-Sweep.js` and
  `plugins/lightsaber.js`, which are themselves invisible to static analysis.
- **`shared/yodamanClient.js` → `API_PATHS`, `readEventStream`, `requestJson`** —
  deliberate public API of a published package. Removing one is a breaking
  change, not a cleanup.
- **`extension.js` → `activate` / `deactivate`** — called by VS Code.
  `deactivate` is intentionally empty; it must stay exported for teardown.
- **`tailwind.config.cjs` / `postcss.config.cjs`** — the exported object *is* the
  contract, read by the tool at build time and never imported.

## Beware: "unused export" counts are usually inflated

Both `knip` and a naive regex pass over this repository reported **85 unused
exports**. An AST-accurate pass found **32**, and all but a handful were either
internally-used helpers that are merely over-exported (harmless) or the
framework contracts listed above.

The failure mode in both cases was the same: counting **nested object-literal
keys as module exports**. Plugin result payloads (`hotspots`, `commitCount`,
`averageHealth`) and config keys (`theme`, `extend`) are data, not exports. If a
report claims a large number of unused exports, verify with a parser before
touching anything.

## What genuinely was dead

For reference, the 0.4.0 sweep removed six files, and every one was confirmed
unreachable from *all* real entry points, not just from `server.js`:

- `backend/services/contextEngine.js` — a casing-duplicate of the live
  `backend/infrastructure/ContextEngine.js`
- `backend/services/chatHandler.js` — state written and never read; both callers
  already validated the value it re-validated
- `src/components/ChatWindow.jsx`, `ModeToggle.jsx`, `Chat/ModeToggle.jsx` —
  superseded by `AgentChatTab`
- `src/components/ManualWindow.jsx` — superseded by static `/manual.html`

## Checklist before deleting a file

1. Run `npx knip` (with the committed config, not bare defaults).
2. Grep for the **basename as a string**, not just as an import:
   `grep -rn "MyFile" --exclude-dir=node_modules .` — catches manifest entries
   and computed paths.
3. Check the JSON manifests: `plugins/plugin.json`, `package.json`
   (`main`/`bin`/`files`), `electron-builder.json`, and each sub-package's
   `package.json`.
4. Boot the plugin loader and confirm the plugin list is unchanged.
5. Run `npm test` **and** `node scripts/release-smoke.js`. A green suite alone
   does not prove a file is unused.
