# YodaMan Mobile Companion

The mobile companion for the YodaMan runtime. It is built for oversight and review away from the keyboard rather than full IDE behaviour, but it reaches the whole runtime: the three-tool pillar, Stardust, blast radius, and the approval gate.

## Current Scope

Six tabs, mirroring the desktop so both clients teach the same model of the
product. Everything Stardust exposes here is read-only: the phone can watch
specs and drift. The only actions that change runtime state are approval
decisions and task cancellation.

- **Connect** — runtime URL, pairing token or `yodaman://pair` link, dependency
  health for all three pillar tools plus Ollama, workspace readiness, and
  project selection.
- **Ask** — project-scoped questions, and ranked search showing which results
  OpenSpec covers.
- **Stardust** — the active OpenSpec change board, drift against the workspace,
  and runtime diagnostics.
- **Impact** — blast radius for any file at a hop depth of 1 to 4, cross-
  referenced across all three tools.
- **Tasks** — task timeline with faction-coloured status, each task's recorded
  events, event payload inspection, and cancellation.
- **Approvals** — pending write proposals with dependents and test coverage,
  behind a confirmation step.

Styling is a direct port of the desktop theme in `src/index.css`, including
the semantic faction palette and the HUD corner brackets the desktop reserves
for the approval gate. See `theme.js`.

For store submission, see `STORE_SUBMISSION.md`.

## Run

From this directory:

```bash
npm install
npm run start
```

For a physical phone, set the runtime URL to the desktop machine's LAN address, for example:

```text
http://192.168.1.20:3090
```

The runtime binds `127.0.0.1` by default, so the phone cannot reach it until
you start it listening on the network, for example `YODAMAN_HOST=0.0.0.0 yodaman`.
Requests from anywhere but the desktop itself then need a pairing token (see
below); `requirePairingToken` is on by default.

The Expo mobile bundler uses `metro.config.js` to include the repository-level `shared/` API client.

## Pairing

Generate a pairing payload from the desktop runtime:

```bash
curl -X POST http://127.0.0.1:3090/api/pairing \
  -H "Content-Type: application/json" \
  -d '{"runtimeUrl":"http://YOUR-MAC-LAN-IP:3090"}'
```

Paste the returned `link` (`deepLink` is the same value) into the Runtime URL
field and tap **Use pairing link**. A token expires after 24 hours and is held
only in the runtime's memory, so restarting the runtime means pairing again.

Native push notifications are not enabled. They require Expo notification dependencies and provider credentials, and nothing in the app claims otherwise.
