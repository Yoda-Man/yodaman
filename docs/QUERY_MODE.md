# Query mode

YodaMan can route questions as either source-code work or documentation work.

## Modes

| Mode | Use it for | Behavior |
| --- | --- | --- |
| `code` | Implementation questions, symbols, functions, stack traces, source files | Uses the normal workspace code context and code search path. |
| `doc` | README, setup, API, usage, support, and explanation questions | Preprocesses documentation and JSDoc into `.yodaman-doc-chunks` before searching. |

The web UI stores the selected mode in `localStorage` under `yodamanMode`. The server validates mode values and accepts only `code` and `doc`.

## API

### `POST /api/mode`

Sets the runtime query mode.

```json
{
  "mode": "doc",
  "projectId": "/absolute/path/to/project"
}
```

Response:

```json
{
  "ok": true,
  "mode": "doc",
  "projectId": "/absolute/path/to/project"
}
```

### `POST /api/ask`

The chat request can include a mode value:

```json
{
  "question": "How do I configure watched directories?",
  "projectId": "/absolute/path/to/project",
  "mode": "doc"
}
```

Invalid mode values return a structured `400` response:

```json
{
  "error": "mode must be one of: code, doc",
  "code": "invalid_request"
}
```

### Search endpoints

- `GET /api/search?query=...` classifies the query automatically.
- `GET /api/search/code?query=...` forces code search.
- `GET /api/search/docs?query=...` forces documentation preprocessing and documentation search.

## Troubleshooting

- If documentation answers are stale, run `POST /api/reindex` for the workspace path.
- If `.yodaman-doc-chunks` grows too large, delete the directory inside the watched workspace and run a docs search again.
- If the UI and backend disagree on mode after an upgrade, clear the browser `yodamanMode` local storage key and select the mode again.
