# YodaMan Mobile Companion

The mobile companion should be a focused oversight client for YodaMan, not a full code editor.

## Primary Workflows

- Check whether the local or paired runtime is online.
- Ask questions about indexed projects.
- Search code semantically.
- Monitor agent tasks.
- Approve or reject proposed changes.
- Receive notifications when an agent needs attention.

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
- `GET /api/agent/pending-approvals`
- `GET /api/policy`
- `GET /api/audit`

## Runtime Follow-Up

The mobile approval inbox can now query pending approvals. A richer production version should add one of the following:

- a task event relay keyed by user/session
- WebSocket support for multi-client task subscriptions
- push notifications for pending approvals

The recommended next runtime addition is `GET /api/agent/tasks/:taskId/events` or WebSocket subscriptions for live mobile task timelines.
