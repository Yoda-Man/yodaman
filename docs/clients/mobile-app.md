# YodaMan Mobile Companion

The mobile companion should be a focused oversight client for YodaMan, not a full code editor.

## Primary Workflows

- Check whether the local or paired runtime is online.
- Select an indexed project.
- Ask questions about indexed projects.
- Search code semantically.
- Monitor persisted agent task timelines.
- Inspect full task event details.
- Cancel active agent tasks.
- Approve or reject proposed changes.
- Receive an in-app alert when refreshed approvals need attention.

## Current Scaffold

The initial scaffold lives in `apps/mobile`.

It uses Expo and React Native, with a small API client for:

- `GET /api/status`
- `GET /api/projects`
- `POST /api/ask`
- `GET /api/search`
- `POST /api/agent/approve`
- `POST /api/agent/cancel`
- `GET /api/agent/tasks`
- `GET /api/agent/tasks/:taskId/events`
- `GET /api/agent/pending-approvals`
- `GET /api/policy`
- `GET /api/audit`

## Runtime Follow-Up

The mobile app can now select projects, route ask/search calls to a project, inspect recent task timelines, open full task event details, cancel active tasks, and use the approval inbox. A richer production version should add one of the following:

- a task event relay keyed by user/session
- WebSocket support for multi-client task subscriptions
- push notifications for pending approvals

The recommended next runtime addition is native push notification delivery or WebSocket subscriptions for live mobile task timelines.

Native push notifications require Expo notification dependencies, platform credentials, and store/provider setup. Those are intentionally left as the next account-backed phase rather than mocked locally.
