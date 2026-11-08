# Linking YodaMan Mobile To Your Machine

The mobile app cannot use `127.0.0.1` to reach your Mac. On a phone, `127.0.0.1` means the phone itself. The app must connect to the Mac's LAN address, a secure tunnel, or a future relay.

## Same Wi-Fi Linking

1. Start YodaMan on your Mac bound to the network. The runtime listens on loopback (`127.0.0.1`) by default, so a phone cannot reach it until you opt in:

   ```bash
   YODAMAN_HOST=0.0.0.0 npm run server
   ```

   The runtime logs `runtime_bound_non_loopback` at startup as a reminder that pairing tokens are now the only control.
2. Find your Mac's LAN IP address, for example `192.168.1.20`.
3. In the mobile app's Connect tab, set the Runtime URL to:

   ```text
   http://192.168.1.20:3090
   ```

4. Enter a pairing token (see below) and tap Connect.

Your phone and Mac must be on the same network, and macOS firewall rules must allow inbound connections to port `3090`.

## Pairing Link

Create a pairing payload from the runtime:

```bash
curl -X POST http://127.0.0.1:3090/api/pairing \
  -H "Content-Type: application/json" \
  -d '{"runtimeUrl":"http://192.168.1.20:3090"}'
```

The response includes:

- `runtimeUrl`
- `token`
- `expiresAt` (24 hours after creation)
- `link` and `deepLink` (the same `yodaman://pair?url=...&token=...` link)

Without `runtimeUrl` in the body, the link uses the host the request was sent to. A loopback address (`localhost`, `127.0.0.1`) is replaced with this machine's LAN address on the same port, so the desktop menu's `Copy Mobile Pairing Link` and the Dashboard's pairing button produce a link a phone can use. Pairing can only be managed from this computer: the pairing routes refuse requests from other machines.

Paste the `deepLink` into the mobile Runtime URL field and tap Use pairing link, or enter the URL and token manually.

Tokens are held in the runtime's memory only, so restarting the runtime invalidates every token. `GET /api/pairing` lists active tokens and `POST /api/pairing/revoke` with `{"token": "..."}` revokes one.

## Token Enforcement

Pairing tokens are required for non-local clients by default (the `requirePairingToken` setting, shown in Settings as Require Pairing Token). To disable that requirement for trusted local-only development, start the runtime with:

```bash
YODAMAN_REQUIRE_PAIRING_TOKEN=false npm run server
```

Localhost clients (requests from `127.0.0.1` or `::1`) still work without a token. Remote clients must send this header on every route; the `/api/pairing` routes are not reachable from other machines at all:

```http
X-YodaMan-Token: <token>
```

## Production Recommendation

Before publishing broadly, use one of these stronger approaches:

- secure relay service tied to user accounts
- mTLS or signed pairing tokens
- HTTPS-only tunnel
- short-lived pairing QR code with explicit device approval
