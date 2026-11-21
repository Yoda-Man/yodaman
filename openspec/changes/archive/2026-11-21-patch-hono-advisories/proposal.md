## Why
`npm audit --omit=dev` reports two moderate advisories in `hono` 4.13.14 (GHSA-4m76-xfj5-7975, GHSA-h7mg-cq63-vhpq, GHSA-3gg2-335m-rxc6, GHSA-46wx-v44x-9hh2, GHSA-4h7h-rv7c-7m2v), pulled in by `@modelcontextprotocol/sdk`. The release gate's `audit:prod` fails only at high severity, so it passed, but 0.6.7 must not ship a known defect.

## What Changes
- Lock `hono` at 4.13.19 (`npm audit fix`); no direct dependency changes.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
None. Dependency maintenance only; no requirement changes.

## Impact
`package-lock.json`; the desktop packages bundle `node_modules`, so they are rebuilt and the release gate re-run.
