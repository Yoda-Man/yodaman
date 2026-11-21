# Desktop App Specification

## Purpose
The YodaMan desktop app is an Electron shell around the local runtime. `electron/main.js` creates the window, tray and menus, starts or reuses the runtime (`server.js`), shows a diagnostics screen until the runtime is healthy, and posts desktop notifications for agent tasks. `electron/preload.js` is the only bridge to the renderer. `electron-builder.json` and `electron/entitlements.mac.plist` define the packaged builds, and `scripts/packaged-smoke.js` plus `tests/electron/*` are the checks that the built app starts and renders.

## Requirements

### Requirement: Runtime address
The desktop app SHALL talk to the runtime at `http://127.0.0.1:<port>`, where the port is `YODAMAN_PORT` or `3090` when unset. Every health probe and API call from the main process SHALL use that address.

#### Scenario: Default port
- **WHEN** the app starts with no `YODAMAN_PORT` set
- **THEN** the runtime URL is `http://127.0.0.1:3090`

#### Scenario: Custom port
- **WHEN** the app starts with `YODAMAN_PORT=3091`
- **THEN** the app probes, spawns and loads `http://127.0.0.1:3091`

### Requirement: Reuse or spawn the runtime
On startup the app MUST first probe `GET /api/desktop/diagnostics` and reuse a runtime that answers with a status below 500. Only when none answers SHALL it spawn `server.js` with its own Electron binary as Node and wait up to 15 seconds for the runtime to answer.

#### Scenario: Runtime already running
- **WHEN** a runtime already answers on the runtime URL
- **THEN** no process is spawned and the app is marked as not managing the runtime

#### Scenario: Spawned runtime environment
- **WHEN** no runtime answers
- **THEN** the app spawns `process.execPath server.js` from the app root with `NODE_ENV=production` and `ELECTRON_RUN_AS_NODE=1`
- **AND** `YODAMAN_DATA_DIR` is the existing value or else Electron's `userData` folder, so config.json and yodaman.db live outside the bundle

#### Scenario: Probe timing
- **WHEN** the app waits for the runtime
- **THEN** it probes every 250 ms with a 1 second request timeout
- **AND** after 15 seconds it fails with `YodaMan runtime did not start at <url>`

### Requirement: Runtime log capture
The app SHALL forward the spawned runtime's stdout and stderr to its own console with a `[runtime] ` prefix and SHALL keep the last 40 lines in memory for the diagnostics screen.

#### Scenario: Log buffer bound
- **WHEN** the runtime has written more than 40 lines
- **THEN** only the most recent 40 lines are shown in the diagnostics screen's Runtime Logs section

#### Scenario: Unexpected exit
- **WHEN** a spawned runtime exits with a non-zero code while the app is not quitting and the exit was not caused by a restart
- **THEN** `Runtime exited with code <code>` is added to the log buffer
- **AND** the window shows the diagnostics screen

#### Scenario: Runtime failed to start or stopped
- **WHEN** the runtime fails to start, a restart or retry fails, or it exits unexpectedly
- **THEN** the diagnostics screen says `The runtime is not running: <error message>. Check the logs below, then press Try Again.` and never that the runtime is running

### Requirement: Main window
The app SHALL open one window of 1280 by 820 (minimum 960 by 640) titled `YodaMan` with background `#0b1020`, `contextIsolation: true`, `nodeIntegration: false` and `electron/preload.js` as the preload script.

#### Scenario: External links
- **WHEN** the page asks to open a new window for a URL
- **THEN** the URL is handed to the OS with `shell.openExternal` and the new window is denied

#### Scenario: Closing hides
- **WHEN** the user closes the window while the app is not quitting
- **THEN** the close is prevented and the window is hidden

#### Scenario: Activate
- **WHEN** the app is activated (for example from the macOS Dock)
- **THEN** the existing window is shown, or a new one is created if none exists

### Requirement: Diagnostics screen
Until the runtime is healthy the window SHALL show a generated diagnostics page that lists seven checks in this order: Node.js, Graphify, Ollama, Context Expert (ctx), OpenSpec, Config, Runtime. The page SHALL poll `GET /api/health` every 2 seconds and fill each row from `checks.node`, `graphify`, `ollama`, `ctx`, `openspec`, `config` and `runtime`.

#### Scenario: Automatic hand-off
- **WHEN** a health poll returns every check with `ok: true` and `started` true
- **THEN** the page navigates to the runtime URL

#### Scenario: Always a way through
- **WHEN** the user clicks **Continue →**
- **THEN** the page navigates to the runtime URL whatever the check results

#### Scenario: Status badge
- **WHEN** some check has `ok: false` and the health `status` is `degraded`
- **THEN** the badge reads `⚠ Running in degraded mode — some dependencies missing`
- **AND** when every check is ok it reads `✓ All systems OK`

#### Scenario: Version shown
- **WHEN** the page renders
- **THEN** the heading shows `v<version>` from package.json, or `vunknown` when it cannot be read

### Requirement: One-click dependency install
The diagnostics page SHALL show an Install button for a failed Ollama, ctx or OpenSpec row. The button MUST call `window.yodamanDesktop.installDependency(component)` when present, which posts `POST /api/setup/repair` and reads back the clicked component's outcome.

#### Scenario: Component outcome
- **WHEN** Repair returns the component under `manual`
- **THEN** the result is `{ ok: false, component, message: "<reason>: <instruction>" }`
- **AND** a component under `failed` or `stillMissing` gives `ok: false` with the failure's error or `<component> is still missing after Repair`, otherwise `{ ok: true, message: "<component> installed" }`

#### Scenario: Error body
- **WHEN** the Repair request fails with a JSON body carrying `error`
- **THEN** the message is that `error` value, and a non-JSON body is shown as is

### Requirement: Retry, copy and dev tools
The diagnostics page SHALL offer **⟳ Try Again**, **📋 Copy Error** and **🔧 Dev Tools**. Try Again MUST kill any spawned runtime, start or reuse one again, load the runtime URL and resume notification polling.

#### Scenario: Retry failure
- **WHEN** Try Again cannot bring the runtime up
- **THEN** `retryRuntime` resolves `{ ok: false, error }`, the page shows `Restart failed: <error>` and the diagnostics screen is shown again

#### Scenario: Copy diagnostics
- **WHEN** the user clicks Copy Error
- **THEN** the clipboard receives `YodaMan Diagnostics`, the check table text and the runtime logs, and the toast reads `Diagnostics copied to clipboard`

### Requirement: Preload bridge
`electron/preload.js` SHALL expose exactly one object, `window.yodamanDesktop`, through `contextBridge`, with four functions mapped to IPC channels handled in the main process.

#### Scenario: Bridge methods
- **WHEN** the renderer reads `window.yodamanDesktop`
- **THEN** `pickWorkspaceFolder()` invokes `yodaman:pick-project-folder`, `retryRuntime()` invokes `yodaman:retry-runtime`, `installDependency(component)` invokes `yodaman:install-dependency` and `openDevTools()` invokes `yodaman:open-dev-tools`

#### Scenario: Folder picker
- **WHEN** Settings calls `pickWorkspaceFolder()` and the user picks a folder
- **THEN** the call resolves the folder path from a `Choose YodaMan Project Folder` directory dialog
- **AND** it resolves `null` when the dialog is cancelled

### Requirement: Application menu
The app SHALL install a `YodaMan` menu with **Restart Managed Runtime**, **Copy Mobile Pairing Link**, **Add Project Folder** and Quit, and a `View` menu with reload, toggle dev tools, reset zoom, zoom in and zoom out.

#### Scenario: Restart an external runtime
- **WHEN** the user picks Restart Managed Runtime while the app reuses a runtime it did not spawn
- **THEN** an info dialog says `YodaMan is using an already-running runtime.` and nothing is restarted

#### Scenario: Pairing link
- **WHEN** the user picks Copy Mobile Pairing Link
- **THEN** the app posts `POST /api/pairing` with `{ runtimeUrl }`, copies the returned `link` to the clipboard and shows `Mobile pairing link copied.`
- **AND** on failure it shows the error box `YodaMan pairing failed`

#### Scenario: Add project folder
- **WHEN** the user picks a folder from Add Project Folder
- **THEN** the app posts `POST /api/projects` with `{ path }`, shows a `YodaMan project added` notification and reloads the window
- **AND** on failure it shows the error box `YodaMan project add failed`

### Requirement: Tray
The app SHALL create a tray icon from `public/favicon.png` with tooltip `YodaMan` and a menu of **Show YodaMan**, **Restart Managed Runtime**, **Copy Mobile Pairing Link** and **Quit**.

#### Scenario: Tray click
- **WHEN** the user clicks the tray icon
- **THEN** the window is hidden if visible and shown if hidden

#### Scenario: Tray quit
- **WHEN** the user picks Quit from the tray
- **THEN** the app is marked as quitting and exits instead of hiding

### Requirement: Task notifications
When notifications are supported, the app SHALL poll `GET /api/agent/tasks` every 5 seconds and post a desktop notification when a task's status changes to `awaiting_approval` or to `completed`.

#### Scenario: Approval needed
- **WHEN** a task's status changes to `awaiting_approval`
- **THEN** a notification titled `YodaMan needs approval` shows the task text, or its `taskId`

#### Scenario: Completed
- **WHEN** a task already seen with another status becomes `completed`
- **THEN** a notification titled `YodaMan task completed` is shown
- **AND** a task first seen as completed produces no notification

### Requirement: Quit and shutdown
On quit the app SHALL kill the runtime only if it spawned it, stop notification polling and destroy the tray. On platforms other than macOS, closing all windows SHALL quit the app.

#### Scenario: Reused runtime survives
- **WHEN** the app quits while reusing a runtime it did not spawn
- **THEN** that runtime keeps running

### Requirement: Packaged build configuration
`electron-builder.json` SHALL build app id `africa.criticalpath.yodaman`, product `YodaMan`, with `asar: false`, output in `release/`, and `electron/main.js` as the packaged main. The bundle MUST include `electron`, `backend`, `shared`, `dist`, `plugins`, `public`, `node_modules`, `server.js`, `config.example.json` and `package.json`.

#### Scenario: Targets
- **WHEN** the desktop build runs
- **THEN** macOS builds `dmg`, `zip` and `dir` in category `public.app-category.developer-tools`, Windows builds `nsis`, `zip` and `dir`, and Linux builds `AppImage`, `zip` and `dir` in category `Development`

#### Scenario: macOS entitlements
- **WHEN** the macOS app is signed
- **THEN** `electron/entitlements.mac.plist` is used for the app and inherited by helpers, granting only `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory`

### Requirement: Packaged runtime smoke
`npm run test:packaged` (`scripts/packaged-smoke.js`) SHALL boot the `server.js` inside the unpacked build on port `YODAMAN_PACKAGED_SMOKE_PORT` (default 3097) with a fresh temporary data folder, and MUST fail unless `/api/health` answers within 60 seconds and `yodaman.db` is written to the data folder, not the bundle.

#### Scenario: No build
- **WHEN** no unpacked app exists under `release/mac-arm64`, `release/mac`, `release/linux-unpacked` or `release/win-unpacked`
- **THEN** it prints `SKIP: no packaged app found under release/ — run a desktop build first.` and exits 0

#### Scenario: Missing file in the bundle
- **WHEN** the packaged runtime fails with `Cannot find module '<x>'`
- **THEN** it prints `Missing from the package: <x>`, the last 25 lines of output, and exits 1

#### Scenario: Database in the wrong place
- **WHEN** the runtime is healthy but `yodaman.db` is missing from the data folder or present in the bundle
- **THEN** the check exits 1

### Requirement: Render smoke tests
`npm run test:render` SHALL run `tests/electron/DesktopRenderSmoke.test.js` and `tests/electron/GraphRenderSmoke.test.js`, which drive a real Electron window against a runtime started from source. The desktop distribution scripts MUST run it before packaging.

#### Scenario: Dashboard mounts
- **WHEN** DesktopRenderSmoke loads the runtime on `SMOKE_PORT` (default 3399)
- **THEN** it fails unless `#root` has children, body text is non-empty, no ReferenceError, SyntaxError or TypeError was logged, and the error boundary is absent

#### Scenario: Graph renders
- **WHEN** GraphRenderSmoke runs on `GRAPH_RENDER_PORT` (default 3099)
- **THEN** `/vendor/vis-network.min.js` is served with more than 100000 bytes and a fixture localised by `localizeVendorScripts` draws a vis network in a real browser

#### Scenario: Skip without build or display
- **WHEN** `dist/index.html` is missing, or Linux has no `DISPLAY`
- **THEN** the desktop render suite is skipped with a warning instead of failing

### Requirement: Diagnostics contract test
`tests/electron/StartupDiagnostics.test.js` SHALL read `electron/main.js` as text and MUST fail if the Continue button, the OpenSpec row, the check key order or the three install buttons drift, or if the page shown after a failed start says the runtime is running.

#### Scenario: Row order
- **WHEN** the check keys and table rows in main.js are compared
- **THEN** keys `node, graphify, ollama, ctx, openspec, config, runtime` pair one to one with rows `Node.js, Graphify, Ollama, Context Expert (ctx), OpenSpec, Config, Runtime`
