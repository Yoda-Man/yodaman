## MODIFIED Requirements

### Requirement: Runtime address
The desktop app SHALL talk to the runtime at `http://127.0.0.1:<port>`, where the port is `YODAMAN_PORT` or `3090` when unset. Every health probe and API call from the main process SHALL use that address.

#### Scenario: Default port
- **WHEN** the app starts with no `YODAMAN_PORT` set
- **THEN** the runtime URL is `http://127.0.0.1:3090`

#### Scenario: Custom port
- **WHEN** the app starts with `YODAMAN_PORT=3091`
- **THEN** the app probes, spawns and loads `http://127.0.0.1:3091`

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
