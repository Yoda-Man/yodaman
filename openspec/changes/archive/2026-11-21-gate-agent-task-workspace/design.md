## Decisions
- **Decision: reuse `resolveProjectPath`**, the helper `/api/ask` uses (registered path or folder name, else 404 `workspace_not_registered`). The session key stays the `projectId` the client sent, so chat history is unchanged.
- **Decision: check before the stream starts**, so a refusal is a normal JSON error, not an SSE event.
- **Decision: the plugin smoke fails, not skips**, when its project is unregistered: a skipped gate would pass a release that measured nothing.
