# YodaMan Ecosystem Implementation Roadmap

## Strategy

Build the ecosystem from the runtime outward. The runtime API is the shared contract for the web UI, VS Code extension, mobile client, desktop app, and CLI. The first implementation target should be the VS Code extension because it stresses the most important runtime concerns: streaming, workspace identity, file diffs, approval, cancellation, and task status.

## Phase 1: Runtime Protocol Stabilization

Goals:

- Make agent events consistent enough for external clients.
- Emit a task identity event at the beginning of every streamed task.
- Add task cancellation.
- Keep existing web UI behavior compatible.

Implementation tasks:

- Add `task_started` SSE event.
- Add `POST /api/agent/cancel`.
- Add cancellation state in `AgentReasoningEngine`.
- Normalize error events with `type`, `taskId`, and `message`.
- Document the event protocol.

Success criteria:

- A client can start a task and immediately know its `taskId`.
- A client can cancel a running task.
- A client can render all task events without relying on log text.

## Phase 2: VS Code Extension MVP

Goals:

- Provide editor-native access to the existing YodaMan runtime.
- Validate the runtime API from an external client.

MVP features:

- Runtime URL setting.
- Status bar item showing YodaMan availability.
- Command to check runtime status.
- Command to ask about the workspace.
- Command to run an agent task.
- Output channel for streamed events.
- Approval handling for `writeFile` events using native VS Code diff views.
- Approve and reject commands.

Success criteria:

- A user can run an agent task from VS Code.
- Tool events stream into the output channel.
- Proposed file writes open as diffs.
- Approval or rejection is sent back to the runtime.

## Phase 3: Desktop Packaging

Goals:

- Turn the existing web app into a first-class desktop control center.
- Manage runtime lifecycle automatically.

Implementation tasks:

- Package the React UI with Electron.
- Run the backend as a sidecar process.
- Add runtime health and restart controls.
- Add OS notifications.
- Add project folder picker.
- Add mobile pairing screen.

Success criteria:

- A user can install and launch YodaMan as a desktop app.
- The runtime starts and stops with the app.
- The current web UI functionality remains available.

## Phase 4: Mobile Companion

Goals:

- Provide a focused companion experience for approvals, monitoring, search, and lightweight prompts.

Implementation tasks:

- Add local-network pairing.
- Add project list and status views.
- Add task timeline.
- Add approval inbox.
- Add semantic search and ask flows.
- Add notifications for pending approvals and completed tasks.

Success criteria:

- A user can pair the phone with the desktop runtime.
- A user can approve or reject pending file changes.
- A user can search and ask about indexed repositories.

## Phase 5: Hardening and Ecosystem Features

Goals:

- Make YodaMan safe, extensible, and reliable across clients.

Implementation tasks:

- Add workspace-scoped file permissions. **Initial implementation complete.**
- Add command safety policies. **Initial deny policy complete.**
- Add plugin permissions and metadata.
- Add audit log APIs. **Initial implementation complete.**
- Add patch-based file edits.
- Add task history replay.
- Add optional secure relay for mobile.
- Extract shared API client and protocol package.

Current status:

- Runtime policy and audit APIs are implemented.
- Mobile pairing payloads are implemented.
- Task event history is queryable.
- An exact-text `applyPatch` tool is implemented.
- VS Code and Google Play publishing workflows are documented and scripted, pending account credentials.

Success criteria:

- Tool execution is auditable and policy-controlled.
- External clients use a shared typed API client.
- The ecosystem can safely support remote and mobile interactions.

## Current First Slice

The first practical execution slice is:

1. Document the ecosystem architecture and roadmap.
2. Add runtime task lifecycle improvements.
3. Scaffold a VS Code extension MVP that connects to the runtime.
4. Verify the existing project still builds and tests.
