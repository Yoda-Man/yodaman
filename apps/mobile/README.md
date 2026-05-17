# YodaMan Mobile Companion

This is the first mobile companion scaffold for the YodaMan runtime. It is intentionally focused on oversight and lightweight actions rather than full IDE behavior.

## Current Scope

- Configure a runtime URL.
- Check runtime status.
- Ask the runtime a question.
- Run semantic search.
- Refresh pending approvals.
- Approve or reject proposed writes.
- Provide API client methods for task cancellation.

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

The desktop runtime must allow the phone to reach port `3090` on the local network.

## Pairing

Generate a pairing payload from the desktop runtime:

```bash
curl -X POST http://127.0.0.1:3090/api/pairing \
  -H "Content-Type: application/json" \
  -d '{"runtimeUrl":"http://YOUR-MAC-LAN-IP:3090"}'
```

Paste the returned `deepLink` into the Runtime URL field and tap Use Pairing Link.
