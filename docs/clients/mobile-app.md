# YodaMan Mobile Companion

The mobile companion is a focused oversight client for YodaMan, not a full code editor.

## Primary Workflows

The app has six tabs: Connect, Ask, Stardust, Impact, Tasks, and Approvals.

- Check whether the paired runtime is online, with Context Expert, Graphify, OpenSpec, and Ollama status and workspace readiness.
- Select an indexed project.
- Ask questions about indexed projects.
- Search code semantically.
- View the Stardust board (active OpenSpec changes) and spec drift, read-only, and run diagnostics.
- Analyse the blast radius of a file before changing it.
- Monitor persisted agent task timelines.
- Inspect full task event details.
- Cancel active agent tasks.
- Approve or reject proposed changes, with a confirmation dialog and the change's impact shown.

Pull to refresh reloads the Connect, Stardust, Tasks, and Approvals tabs. The app does not notify you of new approvals; refresh the Approvals tab to see them.

## Current App

The app lives in `apps/mobile` (`App.js`).

It uses Expo and React Native. Its API client (`apps/mobile/src/api/yodamanClient.js`) wraps the shared client in `shared/yodamanClient.js`; the app calls:

- `GET /api/status`
- `GET /api/health`
- `GET /api/readiness`
- `GET /api/projects`
- `POST /api/ask`
- `GET /api/search`
- `GET /api/stardust/board`
- `GET /api/stardust/drift`
- `GET /api/stardust/diagnose`
- `GET /api/stardust/compose`
- `GET /api/agent/tasks`
- `GET /api/agent/tasks/:taskId/events`
- `POST /api/agent/cancel`
- `GET /api/agent/pending-approvals`
- `POST /api/agent/approve`

Connecting a phone to your machine is covered in [Linking YodaMan Mobile To Your Machine](mobile-linking.md).

## Runtime Follow-Up

The mobile app polls on demand. A richer production version should add one of the following:

- a task event relay keyed by user/session
- WebSocket support for multi-client task subscriptions
- push notifications for pending approvals

The recommended next runtime addition is native push notification delivery or WebSocket subscriptions for live mobile task timelines. (The runtime's only WebSocket today is `/api/stardust/live`, for OpenSpec board updates.)

Native push notifications require Expo notification dependencies, platform credentials, and store/provider setup. Those are intentionally left as the next account-backed phase rather than mocked locally.
