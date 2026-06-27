# Startup, Chat Git/VR, and Search Reliability Design

## Goal

Make the desktop startup screen escapable, place Git controls where users work with repository context, expose Holocron VR only when usable, and ensure literal code searches do not incorrectly return zero results.

## Startup continuation

The Electron startup page will show a `Continue` button alongside its existing recovery controls. The button is always enabled, including while dependency checks are running or after they fail. Activating it stops startup polling and navigates the window to the normal YodaMan dashboard URL. Dependency diagnostics, retry, copy-error, and developer-tools controls remain unchanged.

## Chat Git integration

`GitPanel` will be removed from `Dashboard`. `AgentChatTab` will render it in the right context rail immediately below `Git Context`, inside a nested collapsible region that is closed by default. The panel will operate only on the currently selected workspace; it will no longer offer a dashboard-wide workspace selector.

The existing commit, push, pull, branch, status, and recent-commit behavior remains intact. Changing the selected workspace refreshes the Git state for that workspace.

## Holocron VR launch

`AgentChatTab` will query the existing plugins API. When an enabled plugin named `holocron-vr` is present, a `Load in VR` button appears beside `Clear` in the chat header. The control remains absent while plugin state is loading, when the plugin is missing, or when it is disabled.

Activating the button invokes a backend launch endpoint with the selected workspace path. The backend verifies that `holocron-vr` is loaded before invoking its legacy plugin entry point with an `open` action and the workspace path. Failures are shown in the chat error surface and logged through the existing client-error path.

## Search reliability

`ToolBox.searchCode` remains semantic-first. If ctx throws, returns an unsupported response, or returns an empty result list, it runs the existing bounded filesystem literal search for the selected workspace. A true empty result is returned only when both semantic and literal search find nothing.

This preserves semantic ranking when ctx finds matches and avoids the complexity of merging two ranking systems. The fallback keeps current path validation, ignored directories, file-size limits, result limits, and secret-file exclusions.

The Search UI will distinguish a completed empty search from an untouched query by tracking whether a request has completed. This prevents text typed into the input from displaying “No matches” before the user submits it.

## Error handling

- Startup continuation is deliberately independent of dependency state.
- Git failures continue to use the panel’s inline status.
- VR launch rejects missing or disabled plugins on the server and reports actionable errors in Chat.
- Search backend errors still return structured `search_failed` responses. Empty semantic results are not treated as errors; they trigger literal fallback.

## Test strategy

- Electron startup markup/behavior test: Continue is always enabled and navigates to the dashboard.
- `AgentChatTab` component contract tests: Git Integration follows Git Context, is collapsible and closed initially, and is scoped to the selected workspace.
- VR component/API tests: button hidden without an enabled `holocron-vr`, visible with it, and launch receives the selected workspace path.
- Dashboard test: Git Integration is absent.
- ToolBox search tests: ctx matches are preserved, ctx failures fall back, and empty ctx results fall back to literal matches.
- Search component test: typing alone does not claim zero results; submitting an actual empty search does.
- Existing focused suites plus the full Jest suite and production build are the completion gate.

## Out of scope

This change does not redesign the wider Chat layout, merge semantic and literal result rankings, modify Holocron’s renderer, or change dependency-check requirements.
