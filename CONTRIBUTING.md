# Contributing to YodaMan

Thanks for being here. This is a small project with one maintainer, so this
document is deliberately honest about what that means for your time.

## How we work

**Issues are very welcome.** Bug reports, feature requests, and questions are
the most useful thing you can send. There is a template for each.

**Please open an issue before a pull request.** Not bureaucracy — YodaMan has a
few architectural commitments (below) that are not obvious from reading the
code, and it is unpleasant for everyone when a well-built PR has to be turned
down because it crosses one. A short issue first means we can agree on the
approach while it is still cheap to change.

Small, self-evident PRs — a typo, a broken link, a clearly wrong error message —
can skip that and go straight in.

**Review is not instant.** One maintainer, so expect days rather than hours.

## Getting set up

Node 20 or newer.

```bash
git clone https://github.com/Yoda-Man/yodaman.git
cd yodaman
npm install
npm run dev
```

`npm run dev` runs the backend and the frontend together. `npm run desktop`
launches the Electron app. `docs/guides/Development-Guide.md` has the detail;
`docs/guides/setup.md` covers models and dependencies.

## The bar for a change

```bash
npm run release:verify
```

This is the gate. It must exit 0. It chains, in order: the build, lint, the unit
suites with coverage, a production dependency audit, the vendored-asset audit,
the release smoke test, the user-journey tests, the plugin tests, the approval
smoke test, and the packaged smoke test.

If it is red, the change is not ready — and "it fails on main too" is worth
saying out loud in the PR rather than quietly working around.

Useful while iterating:

| Command | What it runs |
| --- | --- |
| `npm test` | The unit suites |
| `npm run lint` | ESLint (`lint:fix` to autofix) |
| `npm run test:approval` | The approval-gate smoke test |
| `npm run test:coverage` | Coverage report |

## The testing standard

This is the part most likely to differ from what you are used to, so it is worth
reading before you write a test.

**A test has to be shown to be capable of failing.** Write it, then break the
code it covers on purpose, watch the test go red, and restore. A test that has
never been observed failing has not been shown to test anything.

This is not theoretical here. We have shipped a test that compared a field name
that did not exist — it compared `undefined` to `undefined`, passed, and hid a
genuinely broken query. A green result from a check that measured nothing is
worse than a red one, because a red result gets investigated and a green one
ends the investigation.

Two consequences worth applying:

- **Assert the inputs were real before asserting the result.** Non-empty result
  sets, field names that exist. See the first test in
  `tests/frontend/SettingsModalLayout.test.js`, which exists purely to stop the
  rest of that file passing vacuously.
- **Prefer one failing assertion per fault**, so the failure names the cause.

Two files are worth reading as worked examples, both with header comments
explaining the specific bug they exist to catch:
`tests/infrastructure/McpClients.test.js` and
`tests/frontend/SettingsModalLayout.test.js`.

## Architectural commitments

These are settled. A change that crosses one will be declined regardless of how
well it is implemented, so please raise an issue if you think one should move.

**Nothing leaves the machine.** No telemetry, no analytics, no cloud calls, no
API keys. The runtime binds `127.0.0.1` and talks to your local model. A
dependency that phones home is a dependency we do not take.

**The MCP server is read-only, permanently.** YodaMan pauses its own agent's
file writes for approval, with a diff and a graph-derived blast radius. An
external MCP client sits on the far side of that boundary and cannot be made to
run the gate, so it does not get write tools. `tests/interfaces/McpServer.test.js`
fails if a mutating tool name appears, if the server issues a `PUT`, `PATCH` or
`DELETE`, or if it imports a write path.

**MCP client visibility records identity only.** `McpClients` keeps a label, a
count, and timestamps. Never queries, tool arguments, results, or file paths — a
record of what an agent asked about your codebase is a record of what *you* were
working on. `tests/infrastructure/McpClients.test.js` fails if that shape grows.

**The approval gate defaults to deny.** A tool not on the read-only allowlist in
`shared/toolCapabilities.js` requires approval. New tools are gated until
someone deliberately marks them safe; that direction of failure is the point.

**Shared lists have one home.** Ignore paths live in `shared/ignoredPaths.js`
and nowhere else. Four copies of that list once drifted apart and leaked file
descriptors until the process ran out. If you need a list in two places, import
it, and add a drift guard.

## Style

Match the file you are editing — its naming, its comment density, its idioms.
`npm run lint` settles formatting.

Comments here explain *why*, especially where the code looks odd because it is
working around something real. If you fix a subtle bug, a sentence about what
went wrong is worth more than a sentence about what the code does.

## Reporting bugs

Use the bug template. The single most useful thing you can add is the smallest
reproduction you can manage, plus your model and its configured context length —
a surprising share of odd behaviour turns out to be a context window too small
for the prompt.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

Contributions are accepted under the [MIT License](LICENSE).
