# Startup, Chat VR/Git, and Search Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a startup bypass, relocate Git controls into Chat, conditionally launch Holocron VR for the selected workspace, and make empty semantic searches fall back to literal search.

**Architecture:** Keep each behavior in its existing layer: Electron owns startup navigation, `AgentChatTab` composes Chat controls, `GitPanel` accepts one workspace, REST validates and launches plugins, and `ToolBox` owns search fallback. Tests use the repository’s current source-contract style for JSX/Electron UI and behavioral Jest tests for backend logic.

**Tech Stack:** Electron, React 18, Express, Jest, Vite, Context Expert CLI.

---

### Task 1: Search fallback and Search UI state

**Files:**
- Modify: `backend/infrastructure/ToolBox.js`
- Modify: `src/components/SearchWindow.jsx`
- Test: `tests/infrastructure/ToolBox.test.js`
- Test: `tests/components/SearchWindow.test.js`

- [ ] Add a failing ToolBox test that mocks `contextEngine.executeJson` to return `[]`, creates a temporary file containing a literal query, and expects `searchCode` to return that file.
- [ ] Run `npm test -- --runInBand tests/infrastructure/ToolBox.test.js` and confirm the new assertion fails with an empty result.
- [ ] Change `searchCode` so normalized semantic results are returned only when non-empty; otherwise call `searchCodeFilesystem({ query, project, top })`.
- [ ] Add a source-contract test requiring `hasSearched` state, `setHasSearched(true)` after submission, and `hasSearched` in the empty-state condition.
- [ ] Run both focused test files and confirm they pass.

### Task 2: Startup Continue control

**Files:**
- Modify: `electron/main.js`
- Create: `tests/electron/StartupDiagnostics.test.js`

- [ ] Add a failing source-contract test requiring `id="continue-to-dashboard"` and a click handler that assigns `RUNTIME_URL`.
- [ ] Run `npm test -- --runInBand tests/electron/StartupDiagnostics.test.js` and confirm it fails because the control is absent.
- [ ] Add an always-enabled Continue button beside the diagnostics controls and bind it to `window.location.href = RUNTIME_URL`.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Move Git Integration into Chat

**Files:**
- Modify: `src/components/Dashboard.jsx`
- Modify: `src/components/GitPanel.jsx`
- Modify: `src/components/AgentChatTab.jsx`
- Modify: `tests/components/AgentChatTab.test.js`
- Create: `tests/components/Dashboard.test.js`

- [ ] Add failing source-contract assertions that Dashboard does not import/render `GitPanel`, Chat imports it, and a closed `gitIntegration` section renders immediately after Git Context.
- [ ] Run the two focused component tests and confirm the assertions fail.
- [ ] Refactor `GitPanel` to accept `project`, derive its path directly, and remove its project selector.
- [ ] Add `gitIntegration: false` to Chat section state and render `<GitPanel project={selectedProject} />` in a `ContextSection` directly after Git Context.
- [ ] Remove `GitPanel` from Dashboard and re-run both component tests.

### Task 4: Conditional Holocron VR launch

**Files:**
- Modify: `src/api/api.js`
- Modify: `src/components/AgentChatTab.jsx`
- Modify: `backend/interfaces/RestController.js`
- Modify: `tests/components/AgentChatTab.test.js`
- Modify: `tests/interfaces/RestController.test.js`

- [ ] Add failing tests requiring Chat to fetch plugins, detect `holocron-vr`, hide the control otherwise, and call `api.openPlugin('holocron-vr', selectedProject.path)`.
- [ ] Add a failing REST test requiring `POST /plugins/:name/open` to reject absent plugins and invoke a loaded plugin with `{ _action: 'open', project }`.
- [ ] Run both focused suites and confirm failures are caused by missing launch behavior.
- [ ] Add `api.openPlugin(name, project)` and the REST endpoint with loaded-plugin validation.
- [ ] Add Chat plugin detection, launch error handling, and a `Load in VR` button beside Clear.
- [ ] Re-run both focused suites and confirm they pass.

### Task 5: Verification

**Files:**
- Verify all modified files.

- [ ] Run focused tests for ToolBox, SearchWindow, StartupDiagnostics, AgentChatTab, Dashboard, and RestController.
- [ ] Run `npm test -- --runInBand` and confirm zero failures.
- [ ] Run `npm run build` and confirm Vite exits successfully.
- [ ] Review `git diff --check` and the final diff for unrelated changes.
