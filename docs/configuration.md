# Configuration

YodaMan reads persistent workspace configuration from `config.json` and runtime settings from environment variables.

## `config.json`

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ]
}
```

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `watchedDirectories` | `string[]` | Yes | Absolute workspace paths that YodaMan should watch, index, and expose to chat, search, and agent tasks. |

Use absolute paths. The API validates submitted paths and normalizes them before storing or queueing work.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `YODAMAN_PORT` | `3090` | Express runtime port. |
| `YODAMAN_REQUIRE_PAIRING_TOKEN` | `false` | When `true`, non-local clients must send `X-YodaMan-Token` from the pairing flow. |
| `YODAMAN_ALLOW_UNRESTRICTED_PLUGINS` | `false` | Allows plugins that declare unrestricted permissions. Keep disabled for normal use. |
| `VITE_YODAMAN_API_BASE` | `/api` | Frontend API base path. Use this when the UI talks through a proxy or alternate host. |
| `VITE_YODAMAN_FETCH_TIMEOUT_MS` | `30000` | Browser fetch timeout in milliseconds. |

## Security notes

- Pairing tokens are temporary in-memory credentials for mobile and LAN clients.
- Local requests are allowed when pairing enforcement is enabled so the desktop/web UI can continue to operate.
- Plugin permissions are visible through `GET /api/policy`; review them before enabling third-party plugins.
