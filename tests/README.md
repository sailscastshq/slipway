# Test suite structure

Slipway keeps three test lanes:

- `tests/unit` for helpers, models, and isolated logic.
- `tests/functional` for fast Sounding request and Inertia page contracts using `get()`, `post()`, `visit()`, and `auth.request.*`.
- `tests/e2e/pages` for browser-backed Sounding trials only, using `{ browser: true }` when the DOM or navigation is the behavior under test.

When a test can be proven with request or Inertia helpers, it belongs in `functional`.
When the browser itself matters, it belongs in `e2e`.
Add a browser scenario to the existing test file for its owning page (for
example, a Bridge record action toast belongs in `projects/bridge-record.test.js`). Use a
separate file when it covers a distinct page or needs an independent,
expensive fixture; keep the browser shards balanced instead of growing one
page file without bound.
Do not add tests that merely inspect component source for imports, tags, or
class strings when a browser trial already checks the resulting behavior.
Keep unit tests for meaningful data transformations and decisions.

Run the complete Sounding 0.2 suite with `npm test`, or a single lane with
`npm run test:unit`, `npm run test:functional`, or `npm run test:e2e`.

CI runs unit and functional lanes alongside three isolated browser shards. All
browser files still run once: Sounding's `--shard=1/3`, `2/3`, and `3/3` divide
the file list, while each runner keeps `--test-concurrency=1` because fixtures
share ports and state. `Test (e2e)` succeeds only when all browser shards succeed.
Local `npm run test:e2e` still runs the whole suite.

Superseded PR and branch runs are cancelled; release verification uses its own
concurrency group. Test jobs print slow-trial profiles to guide future reductions.
Contract tests remain intact: recent timings show the serial browser suite was
the critical path, not the small storage, schema, or asset checks.

## Coolify migration rehearsal

Run `node scripts/rehearse-coolify-migration.js` from a clean checkout with its
lockfile dependencies installed. It composes existing offline contracts with
`tests/functional/api/coolify-migration.test.js`, which inspects three isolated
source/configuration inventories. The generated sources intentionally refuse
startup and never contact their `.invalid` database/Redis addresses. A passing
readiness report is not connectivity or application recovery proof.

The default stage requires neither Docker nor Chromium. It covers readiness
invalidation and names-only output, source isolation, app cutover/restart
contracts, restore failure/interruption semantics and request-level
Bridge/Helm/Lookout smoke checks. Docker/container transports are doubled in
those tests; none claims to migrate a running app or database.

The optional `--docker` stage requires an explicitly disposable runner with a
local Unix-socket Docker context, no production resources, and these already
prepared images:

- `postgres:17-alpine`
- `postgres:15-alpine`
- `node:22-alpine`
- `alpine` (the existing Caddy route-label helper uses this local tag)
- `lucaslorentz/caddy-docker-proxy@sha256:f3ebe7e762bccf17ce38b88420f80ce63f69dc548eea0cd6e5f29db2ae2ea062`

Point `SLIPWAY_STORAGE_EMULATORS` at the same local emulator `node_modules` used by
the Storage contract CI job (S3rver 3.7.1). Set
`SLIPWAY_MIGRATION_DISPOSABLE=1` only after checking the Docker target. The runner
installs/pulls nothing and rejects remote Docker transports and inherited
`SLIPWAY_DOCKER_BINARY` / Sails Docker-config environment overrides, so runtime
helpers cannot silently select a different executable from preflight. Use an
unmodified checkout configuration. It runs the existing
external PostgreSQL, stored-backup restore, and Caddy route recovery contracts;
these use disposable synthetic data, unique resources and scoped cleanup. The
normal CI jobs already run those contracts individually. Never point this stage
at a live Docker host or use global Docker prune for cleanup.

This is layered evidence, not a three-running-app end-to-end test. Real Redis
session/queue continuity, application-side PostgreSQL reads, the integrated
three-Sails-app journey and public DNS/TLS remain operator gates. Record what ran
and what did not in the [migration runbook](../docs/coolify-migration.md).
