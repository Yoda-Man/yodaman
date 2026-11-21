# HTTP Server and Access Specification

## Purpose
The YodaMan runtime is one Express 5 server that serves the API, the built web UI and a WebSocket. This capability covers how it starts and stops (`server.js`, `start.js`), the port, host and environment variables, the order of middleware, error shapes (`backend/interfaces/support/http.js`), the cross-site guard (`backend/infrastructure/OriginPolicy.js`), mobile pairing tokens (`backend/infrastructure/PairingService.js`), `GET /api/policy`, the `/api/pairing` routes, and which routes a paired device may call.

## Requirements

### Requirement: Port and host
The runtime SHALL listen on `YODAMAN_PORT` (default 3090) and bind `YODAMAN_HOST` (default `127.0.0.1`). Any other host than `127.0.0.1` or `localhost` SHALL log the warning `runtime_bound_non_loopback`.

#### Scenario: Default bind
- **WHEN** neither variable is set
- **THEN** the server listens on `127.0.0.1:3090` and logs `runtime_started` with `url: "http://localhost:3090"`

#### Scenario: Opened to the network
- **WHEN** `YODAMAN_HOST=0.0.0.0` is set
- **THEN** the warning says `API is reachable from other devices on this network. Pairing tokens are the only control.`

#### Scenario: Port taken
- **WHEN** listening fails with `EADDRINUSE`
- **THEN** `runtime_port_in_use` is logged, stderr says `YodaMan cannot start: port <port> is already in use.` with an `lsof` command and the `YODAMAN_PORT=3091 yodaman` example, and the process exits with code 2

### Requirement: Middleware order
The app SHALL apply, in order: CORS for loopback origins only, the JSON body parser, the request id, the request logger, security headers, static files from `dist/` when that folder exists, the API router at `/api`, the error handler, and the single-page fallback `GET /*splat`. The API router SHALL treat a request with no JSON body as an empty body `{}`, and MUST end with a JSON 404 so no `/api` path reaches the fallback.

#### Scenario: Security headers
- **WHEN** any response is sent
- **THEN** it carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`
- **AND** `Content-Security-Policy: default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' http://localhost:* http://127.0.0.1:*`

#### Scenario: Static UI
- **WHEN** `dist/` exists at startup
- **THEN** its files are served and `serving_production_frontend` is logged

### Requirement: Single-page fallback
Any GET outside `/api` that no earlier handler answered SHALL be served `dist/index.html`. When the UI is not built it SHALL answer 404 with the text `Frontend not built. Run npm run build.`

#### Scenario: Deep link
- **WHEN** the browser loads `/workspace/settings`
- **THEN** `dist/index.html` is returned so the UI router can handle the path

#### Scenario: Unknown API path
- **WHEN** a client calls `GET /api/no-such-route`
- **THEN** the answer is 404 `{ error: "No API route for GET /api/no-such-route", code: "not_found" }`, not the web app

### Requirement: Error shapes
Route errors SHALL be JSON `{ error, code }` from `jsonError`. An error that reaches the app error handler SHALL answer 500 `{ error, requestId, code: "http_unhandled_error" }` and be logged as `http_unhandled_error` with severity `critical`.

#### Scenario: Validation helpers
- **WHEN** `validateString` gets a missing or blank value for `path`
- **THEN** it throws status 400 with `path must be a non-empty string`
- **AND** a value over its limit gives `<name> must be <max> characters or fewer`, and `resolveUserPath` rejects a null byte with `<name> cannot contain null bytes`

#### Scenario: Unhandled error
- **WHEN** a handler throws
- **THEN** the response includes the request's `requestId`, matching its `X-Request-Id` header

#### Scenario: No JSON body
- **WHEN** `PUT /api/settings`, `POST /api/pairing/revoke` or `POST /api/agent/approve` is sent with no body
- **THEN** the answer is the route's own 400 with a `code` (`invalid_settings`, `invalid_token`, `invalid_task_id`), not a 500

### Requirement: This computer
A request SHALL count as from this computer only when its source address is `127.0.0.1`, `::1` or `::ffff:127.0.0.1`. This check MUST NOT be treated as safe alone; the cross-site guard SHALL run before it.

#### Scenario: LAN address
- **WHEN** a request arrives from `192.168.1.20`
- **THEN** it is not from this computer

### Requirement: Cross-site guard
The first middleware on `/api` SHALL reject any request whose `Origin` header is present and not a loopback web origin, and any request with `Sec-Fetch-Site: cross-site`. CORS SHALL reflect loopback origins only and never `*`.

#### Scenario: Remote page
- **WHEN** a page on `https://example.com` calls `PUT /api/settings` through the user's browser
- **THEN** the answer is 403 `{ error: "Cross-site requests are not permitted", code: "cross_site_blocked" }`

#### Scenario: Local origins
- **WHEN** `Origin` is `http` or `https` on `localhost`, `127.0.0.1` or `[::1]`, at any port
- **THEN** the request passes, which covers the built UI, the Vite dev server on 5190 and the desktop shell
- **AND** the origin `null` and an origin that will not parse are rejected

#### Scenario: Not a browser
- **WHEN** a request has neither `Origin` nor `Sec-Fetch-Site`
- **THEN** it passes the guard and goes on to the token gate

### Requirement: Pairing token gate
After the cross-site guard, every `/api` request except `/api/pairing` SHALL need a valid `X-YodaMan-Token` header when `requirePairingToken` is on and the request is not from this computer.

#### Scenario: No token
- **WHEN** a LAN device calls `GET /api/health` without a valid token
- **THEN** the answer is 401 `{ error: "Valid YodaMan pairing token is required", code: "pairing_token_required" }`

#### Scenario: Gate off
- **WHEN** `requirePairingToken` is false
- **THEN** non-local requests pass without a token

#### Scenario: Local process
- **WHEN** a request comes from this computer with no browser headers
- **THEN** it passes without a token

### Requirement: Pairing tokens
`PairingService` SHALL make tokens of 24 random bytes in base64url that expire after 24 hours, held in memory only, so a restart drops every token. Expired tokens SHALL be refused and removed.

#### Scenario: Create a pairing
- **WHEN** `POST /api/pairing` is called with optional `runtimeUrl`
- **THEN** the answer is 201 `{ runtimeUrl, token, expiresAt, link, deepLink }` with `link` equal to `deepLink`, `yodaman://pair?url=<encoded url>&token=<encoded token>`

#### Scenario: Phone-reachable URL
- **WHEN** the base URL is on `localhost`, `127.0.0.1` or `::1`, or is missing
- **THEN** the host is replaced by this machine's first non-internal IPv4 address with the same port (3090 when none), or `127.0.0.1` when there is none
- **AND** a URL that will not parse is passed through as given

#### Scenario: List and revoke
- **WHEN** `GET /api/pairing` is called
- **THEN** it returns an array of `{ createdAt, expiresAt }` for live tokens, never the tokens themselves
- **AND** `POST /api/pairing/revoke` with `token` answers `{ revoked: true|false }`, and without it 400 code `invalid_token`, `token is required`

### Requirement: Pairing from this computer only
All `/api/pairing` routes MUST only be accepted from this computer, because they are exempt from the token gate.

#### Scenario: LAN device tries to pair
- **WHEN** a non-local request calls any `/api/pairing` route
- **THEN** the answer is 403 code `pairing_local_only`, `Pairing can only be managed from this computer`

### Requirement: What a paired device may call
A request with a valid token from another device SHALL reach every `/api` route except those limited to this computer. The limited routes MUST answer 403 to it.

#### Scenario: Refused to a paired device
- **WHEN** a paired device calls `PUT /api/settings`, `POST /api/ctx/config` or `POST /api/ollama/context`
- **THEN** the answer is 403 code `settings_local_only`
- **AND** `DELETE /api/logs` gives `logs_local_only`, `DELETE /api/audit` gives `audit_local_only`, `POST /api/setup/repair` gives `repair_local_only` (after the `allowSelfHealInstall` check), `POST /api/editor/open` and `GET /api/editor/options` give `editor_local_only`, `POST /api/stardust/run` with action `install` gives `repair_local_only`, and `/api/pairing` gives `pairing_local_only`

#### Scenario: Allowed to a paired device
- **WHEN** a paired device calls read routes such as `GET /api/health`, `GET /api/settings`, `GET /api/logs`, `GET /api/audit` or `GET /api/policy`
- **THEN** the request is handled normally

### Requirement: GET /api/policy
`GET /api/policy` SHALL return the agent's tool policy: `allowedRoots`, `allowedExecutables` (sorted), `blockedCommandPatterns` (as strings), `auditLog` and `plugins`.

#### Scenario: Policy body
- **WHEN** the policy is read
- **THEN** `auditLog` is `{ enabled: true, maxEntries: 500 }`
- **AND** each plugin is `{ name, permissions, restricted }`, where `restricted` is false only when its permissions include `unrestricted`

### Requirement: WebSocket upgrade
The HTTP server SHALL accept WebSocket upgrades at `/api/stardust/live`, outside the Express middleware, and send a `snapshot` message as soon as a client connects. The upgrade MUST pass the same origin and pairing gates as the REST routes (`allowUpgrade` in `StardustLive.js`).

#### Scenario: Cross-site page refused
- **WHEN** an upgrade carries an `Origin` that is not a loopback web origin, or `Sec-Fetch-Site: cross-site`
- **THEN** the upgrade is refused with HTTP 401 and no snapshot is sent

#### Scenario: Other device needs a token
- **WHEN** an upgrade comes from an address other than loopback and `requirePairingToken` is on
- **THEN** it is accepted only with a valid `X-YodaMan-Token` header

#### Scenario: Live board
- **WHEN** a client connects to `/api/stardust/live?projectRoot=<path>`
- **THEN** it receives `{ type: "snapshot", data }` for that project, or `{ type: "error", message }` if the snapshot fails
- **AND** without `projectRoot` the runtime's working folder is used

### Requirement: Startup and shutdown
After listening, the runtime SHALL log `data_dir_ready`, report setting drift, then run the startup checks without letting any failure stop the process. `SIGINT` and `SIGTERM` SHALL stop indexing, ctx processes and file watchers and exit 0. An uncaught exception other than `EADDRINUSE` SHALL be logged as `runtime_uncaught_exception` and exit 1.

#### Scenario: Unhandled promise rejection
- **WHEN** a promise rejects with no handler
- **THEN** `runtime_unhandled_rejection` is logged with severity `critical` and the process keeps running

### Requirement: Development start
`npm start` (`node start.js`) SHALL check that `ctx --version`, Graphify `--help` and `ollama --version` succeed, then run `npm run dev`, which runs the server and the Vite client together. A failed check SHALL exit 1.

#### Scenario: Graphify outside PATH
- **WHEN** `YODAMAN_GRAPHIFY_BIN` is set
- **THEN** that file is used; otherwise `~/Library/Python/*/bin/graphify`, else `graphify`
- **AND** on failure the script prints `Install it with: python3 -m pip install --user graphifyy`
