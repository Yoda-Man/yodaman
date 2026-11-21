## MODIFIED Requirements

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

### Requirement: Single-page fallback
Any GET outside `/api` that no earlier handler answered SHALL be served `dist/index.html`. When the UI is not built it SHALL answer 404 with the text `Frontend not built. Run npm run build.`

#### Scenario: Deep link
- **WHEN** the browser loads `/workspace/settings`
- **THEN** `dist/index.html` is returned so the UI router can handle the path

#### Scenario: Unknown API path
- **WHEN** a client calls `GET /api/no-such-route`
- **THEN** the answer is 404 `{ error: "No API route for GET /api/no-such-route", code: "not_found" }`, not the web app

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

### Requirement: What a paired device may call
A request with a valid token from another device SHALL reach every `/api` route except those limited to this computer. The limited routes MUST answer 403 to it.

#### Scenario: Refused to a paired device
- **WHEN** a paired device calls `PUT /api/settings`, `POST /api/ctx/config` or `POST /api/ollama/context`
- **THEN** the answer is 403 code `settings_local_only`
- **AND** `DELETE /api/logs` gives `logs_local_only`, `DELETE /api/audit` gives `audit_local_only`, `POST /api/setup/repair` gives `repair_local_only` (after the `allowSelfHealInstall` check), `POST /api/editor/open` and `GET /api/editor/options` give `editor_local_only`, `POST /api/stardust/run` with action `install` gives `repair_local_only`, and `/api/pairing` gives `pairing_local_only`

#### Scenario: Allowed to a paired device
- **WHEN** a paired device calls read routes such as `GET /api/health`, `GET /api/settings`, `GET /api/logs`, `GET /api/audit` or `GET /api/policy`
- **THEN** the request is handled normally

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

### Requirement: Development start
`npm start` (`node start.js`) SHALL check that `ctx --version`, Graphify `--help` and `ollama --version` succeed, then run `npm run dev`, which runs the server and the Vite client together. A failed check SHALL exit 1.

#### Scenario: Graphify outside PATH
- **WHEN** `YODAMAN_GRAPHIFY_BIN` is set
- **THEN** that file is used; otherwise `~/Library/Python/*/bin/graphify`, else `graphify`
- **AND** on failure the script prints `Install it with: python3 -m pip install --user graphifyy`
