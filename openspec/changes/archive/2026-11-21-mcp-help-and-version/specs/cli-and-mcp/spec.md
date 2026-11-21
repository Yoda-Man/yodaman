## MODIFIED Requirements

### Requirement: MCP server transport
`yodaman-mcp` SHALL serve the Model Context Protocol over stdio as server `yodaman` with the package version. stdout MUST carry only protocol messages, and diagnostics SHALL go to stderr prefixed `[yodaman-mcp] `. `--help`/`-h` and `--version`/`-v` MUST print and exit without starting the server.

#### Scenario: Ready
- **WHEN** the server connects its stdio transport
- **THEN** stderr gets `[yodaman-mcp] v<version> ready on stdio, proxying <runtime> (read-only)`

#### Scenario: Runtime address
- **WHEN** the server starts
- **THEN** the runtime is `YODAMAN_URL`, else `http://127.0.0.1:<YODAMAN_PORT or 3090>`, and each request times out after `YODAMAN_MCP_TIMEOUT` ms (default 120000)

#### Scenario: Help
- **WHEN** the user runs `yodaman-mcp --help` or `yodaman-mcp -h`
- **THEN** stdout shows the usage, the five tools and the runtime URL with the `YODAMAN_PORT`/`YODAMAN_URL` overrides, and the command exits 0 without starting the server

#### Scenario: Version
- **WHEN** the user runs `yodaman-mcp --version` or `yodaman-mcp -v`
- **THEN** stdout is the package version and the command exits 0
