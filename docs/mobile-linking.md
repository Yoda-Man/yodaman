# Linking YodaMan Mobile To Your Machine

The mobile app cannot use `127.0.0.1` to reach your Mac. On a phone, `127.0.0.1` means the phone itself. The app must connect to the Mac's LAN address, a secure tunnel, or a future relay.

## Same Wi-Fi Linking

1. Start YodaMan on your Mac.
2. Find your Mac's LAN IP address, for example `192.168.1.20`.
3. In the mobile app, set Runtime URL to:

   ```text
   http://192.168.1.20:3090
   ```

4. Tap Check Status.

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
- `expiresAt`
- `deepLink`

Paste the `deepLink` into the mobile Runtime URL field and tap Use Pairing Link, or enter the URL and token manually.

## Token Enforcement

Pairing tokens are required for non-local clients by default. To disable that requirement for trusted local-only development, start the runtime with:

```bash
YODAMAN_REQUIRE_PAIRING_TOKEN=false npm run server
```

Localhost clients still work without a token. Remote clients must send:

```http
X-YodaMan-Token: <token>
```

## Production Recommendation

Before publishing broadly, use one of these stronger approaches:

- secure relay service tied to user accounts
- mTLS or signed pairing tokens
- HTTPS-only tunnel
- short-lived pairing QR code with explicit device approval
