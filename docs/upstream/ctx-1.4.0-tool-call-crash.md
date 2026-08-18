# Bug report — `@contextexpert/cli` 1.4.0

**Title:** `ctx ask` exits 1 with "Failed to connect to Ollama server" when the
prompt uses `<tool_call>` syntax — the real fault is an unguarded property
access, and Ollama is reachable throughout

**Severity:** High — any prompt that instructs the model to emit a tool call
fails, after part of the answer has already been streamed to stdout.

---

## Summary

Prompting a local model through `ctx ask` with the literal string `<tool_call>`
causes ctx to exit 1 with:

```
Error: Failed to connect to Ollama server: Cannot read properties of undefined (reading 'content')
```

The message is misleading in two ways. Ollama is running and reachable for the
entire request — the same project answers a plain prose question successfully
seconds earlier. And the underlying error is a `TypeError` from dereferencing an
undefined value, not a network fault; it is reported as a connection error only
because of how errors are classified (see *Root cause*).

The failure happens **after** ctx has already streamed the first part of the
answer to stdout, so callers see a truncated answer plus a connection error that
sends them to debug the wrong subsystem.

## Environment

| | |
|---|---|
| `@contextexpert/cli` | 1.4.0 |
| `@contextaisdk/provider-ollama` | 0.1.0 (bundled) |
| Ollama | 0.30.8 |
| Model | `qwen3.5:9b` |
| Node | v22.22.2 |
| OS | macOS 26.5.2, arm64 |

## Reproduction

Against any indexed project:

```bash
# FAILS — exit 1
ctx ask -p <project> -- 'You are an agent. Tools: readFile(filePath).
Rules:
- Call: <tool_call>{"name":"tool","parameters":{}}</tool_call>
- One tool call per turn.

Task: read package.json and report the version.'
```

```bash
# SUCCEEDS — exit 0, identical project and model
ctx ask -p <project> -- 'What version is this project? Answer in one sentence.'
```

The only difference is the tool-call framing. Replacing the `<tool_call>`
delimiter with a plain-text one — everything else in the prompt unchanged — also
succeeds and returns the tool call as literal text:

```bash
# SUCCEEDS — exit 0
ctx ask -p <project> -- 'You are an agent. Tools: readFile(filePath).
To use a tool, write a line of plain text exactly like:
TOOL_CALL {"name":"readFile","parameters":{"filePath":"package.json"}}
Write it as literal text. Do not call functions.

Task: read package.json and report the version.'
```

## What we ruled out

- **Ollama being unreachable.** `GET /api/tags` responds throughout, the model
  stays loaded, and prose questions against the same project succeed between
  failing runs.
- **Malformed chunks on the wire.** We streamed `POST /api/chat` directly from
  Ollama, both with and without a `tools` array: 141 chunks and 85 chunks
  respectively, and **every** chunk carried a `message` field. Nothing arriving
  from Ollama is missing the property being dereferenced.

That leaves the message ctx constructs for the follow-up request.

## Root cause

Two defects compound, which is why the reported message points away from the
actual fault.

**1. Unguarded property access on the outgoing path.**
`@contextaisdk/provider-ollama/src/message-mapper.ts:46`

```ts
export function mapMessage(message: ChatMessage): OllamaMessage {
  const content = message.content;   // throws when `message` is undefined
```

`mapMessage` is called per element of the outgoing messages array. When the
model responds with a native tool call, the follow-up request appears to contain
an `undefined` entry, and this line raises
`TypeError: Cannot read properties of undefined (reading 'content')`.

Relatedly, `types.ts:150` declares `message` as **required** on
`OllamaStreamChunk`, so the type system offers no signal that a missing value is
possible anywhere in this path.

**2. Every `TypeError` is classified as a connection failure.**
`@contextaisdk/provider-ollama/src/errors.ts:118`

```ts
if (error instanceof TypeError) {
  // Network errors from fetch (e.g., "Failed to fetch")
  return new OllamaProviderError(
    `Failed to connect to Ollama server: ${error.message}`,
    'OLLAMA_CONNECTION_ERROR',
    { cause: error }
  );
}
```

`fetch` does raise `TypeError` for network faults, but so does any null
dereference in the surrounding code. A programming error inside the provider is
therefore reported to users as an infrastructure problem, with a code of
`OLLAMA_CONNECTION_ERROR`.

## Why the trigger is the delimiter

`qwen3.5:9b` appears to switch into Ollama's native function-calling mode when
the prompt contains the literal string `<tool_call>`, populating `tool_calls`
rather than replying in text. ctx then builds a follow-up message for a tool it
has no registration for, and defect 1 fires. A prompt asking for the same
behaviour under a different delimiter never triggers native mode and works.

## Suggested fixes

1. **Guard the dereference** in `mapMessage` and skip or reject nullish entries
   with a specific error naming the offending index.
2. **Narrow the `TypeError` branch** in `errors.ts` so only genuine fetch
   failures are reported as `OLLAMA_CONNECTION_ERROR` — for example by checking
   `error.cause`, matching the fetch failure message, or wrapping only the
   `fetch` call rather than the whole request path. A null dereference inside the
   provider should surface as a provider error, not a connection error.
3. **Correct the `OllamaStreamChunk.message` type** if it can legitimately be
   absent.
4. Consider handling the case where a model returns a native tool call that ctx
   has no matching registration for, rather than building an unusable follow-up
   message.

Fix 2 alone would not resolve the crash, but it would have made the cause
obvious immediately rather than sending us to inspect Ollama.

## Impact for us

We build an agent loop on `ctx ask`. This defect made **every** agent task
requiring a tool fail, while prose questions succeeded — so the product appeared
healthy right up to the point a user asked it to do something. We have worked
around it by changing our tool-call delimiter away from `<tool_call>`.
