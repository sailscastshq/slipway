# Rehearse a three-app Coolify migration

This runbook connects existing Slipway capabilities. It is a planning and
**disposable-data rehearsal**, not a migration engine or permission to change
production. Blue-green app deployment does not guarantee a zero-downtime database,
Redis, DNS, or TLS migration. The [Acid Test](../RESEARCH.md#the-acid-test) is a goal;
complete the evidence gates below before treating it as demonstrated.

## 1. Inventory before changing anything

Use three separate projects, each with one `web` app and a `production`
environment, when the three apps need independent hostnames. A custom domain
belongs to an **environment**, not each app. Routed apps within one environment
share its hostname. See the [CLI domain contract](../packages/cli/README.md#custom-domains).

The [synthetic inventory](../tests/fixtures/coolify-migration/inventory.json)
contains no credentials:

| Project            | Runtime/start           | Health     | Domain                | Required variable names                        | PostgreSQL choice                                | Redis responsibility                                                    |
| ------------------ | ----------------------- | ---------- | --------------------- | ---------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| `migration-atlas`  | Node 22 / `node app.js` | `/health`  | `atlas.example.test`  | `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`  | External first, database `atlas`                 | Durable sessions, `atlas:sessions`                                      |
| `migration-harbor` | Node 22 / `node app.js` | `/ready`   | `harbor.example.test` | `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`  | Reviewed dump into new managed database `harbor` | Durable sessions, `harbor:sessions`                                     |
| `migration-beacon` | Node 24 / `node app.js` | `/statusz` | `beacon.example.test` | `DATABASE_URL`, `REDIS_URL`, `QUEUE_NAMESPACE` | Reviewed dump into new managed database `beacon` | Queue, `beacon:jobs`; HTTP app plus separately controlled job execution |

These are synthetic names, not reachable sites. Source fixtures intentionally
refuse startup; they verify admission, not application behavior. Do not deploy
them or substitute real connection values into automated fixtures.

For **each real app**, prepare a private inventory of:

- Exact source repository/commit or uploaded revision, lockfile, Dockerfile path,
  build context, build command, launch command, Node/Sails/hook versions, resource
  limits, persistent files/uploads, and current Coolify release
- Internal port `1337`, HTTP health path, route prefix, expected status/body, and
  the database/Redis dependencies the probe actually verifies. A 2xx-only probe
  cannot establish data integrity or working login/job execution
- Required environment-variable **names** and their owner/scope: instance,
  environment, app. Resolve overrides deliberately. Record secret-manager
  references separately; never paste values, connection strings, CLI env listings,
  terminal histories, or raw Docker inspection into the rehearsal evidence
- Current/generated/custom hostname, A/AAAA/CNAME records, TTL, proxy/tunnel mode,
  certificate issuer/expiry, DNS owner, provider firewall, and old/new routes
- PostgreSQL server/client versions, database names and sharing between apps,
  owners/roles/extensions, migration history, RLS, encoding/collation, database
  size, acceptable recovery point, and all writers outside the web process
- Redis version, URL-variable name, session cookie/secret/prefix/TTL, queues and
  consumers, scheduled jobs, retries/delayed jobs, locks, socket adapter, and
  whether each keyspace is disposable cache or durable state

Keep real source and test inventories separate. Use synthetic seed records and
no outgoing mail, payment, webhook, customer integration, or scheduled side
effects in a disposable rehearsal.

## 2. Choose the database boundary

### A. External PostgreSQL first

Leave the existing PostgreSQL database where it is and connect it through
**Add service → External PostgreSQL**. Follow the
[external PostgreSQL contract](external-postgresql.md) for versions, verification,
TLS/CA, network reachability, variable naming, and backup permissions. It creates
`DATABASE_URL` only if unused, otherwise a service-derived variable; make the app
use the intended effective variable. A verified backup client does not configure
the application's driver TLS.

This separates the app move from a later database move. Verify app-side
connectivity and a genuine backup, not just a green service status. Keep the
source database lifecycle independent of retiring Coolify; do not delete a
Coolify-managed database with the old app. Both fleets must use compatible schema
and session settings. Fence background writers/queue consumers before enabling
the replacement; blue-green web health checks do not prevent duplicate jobs.

**Restore into an external PostgreSQL service is unavailable in both UI and
backend.** Recover through a reviewed provider/`pg_restore` procedure into a
separate database, then deliberately change the app connection. Do not attempt to
use Slipway's backup restore to bypass this limit.

### B. Reviewed dump into a new managed PostgreSQL database

Provision a new, empty managed database through **Add service**. Keep the source
untouched. Review compatible PostgreSQL versions, roles/extensions, owners,
privileges and application schema before importing. Use a reviewed PostgreSQL
client workflow against the **new target only**; prefer an atomic
`pg_restore --exit-on-error --single-transaction` where compatible with the
reviewed dump. A failed non-atomic import may leave a partially populated target.
Discard/recreate that disposable target or inspect/reconcile it before retrying.

There is no general Coolify archive upload/import command. `backup:restore`
restores a recorded Slipway backup to its associated managed service; it is not
an arbitrary-dump uploader or a cross-service database copier. The
[restore-operation contract](restore-operations.md) governs that destructive
operation, including write pause, safety snapshot, durable operation ID, and
interruption recovery. For deliberate recovery of an already recorded managed
backup, after the operator has paused every writer:

```sh
slipway backup:restore BACKUP_ID --writes-paused
```

This acknowledgement does not pause writers for you. Record the returned
operation ID, inspect its terminal status, and verify data before resuming.

An early copy is only a rehearsal. For the final copy, stop admission of writes,
drain in-flight work, pause **all three apps and all other writers** sharing the
database, stop/drain queue consumers and scheduled jobs, and verify the fence.
Take the final dump only after the fence. Keep writes paused through import,
verification and routing. Budget a maintenance window; an online replication
migration is a separate reviewed plan, not a capability asserted here.

### Redis is a separate decision

Reusing the same reachable Redis with compatible prefixes, session secret and
cookie settings avoids an unplanned session reset. It does not solve two fleets
consuming the same job twice. Confirm one active consumer/scheduler owner and
idempotency before switching. For a fresh Redis, explicitly choose whether to
expire sessions/rebuild cache or perform a separately verified Redis transfer.
Do not treat queues, delayed jobs, locks or user sessions as disposable cache.
Slipway does not infer these semantics or migrate Redis state during app cutover.

## 3. Verify backup and recovery before cutover

Use [private backup storage](backup-storage.md). For every PostgreSQL database:

1. Record the dump's source database, source version, timestamp, size, SHA-256,
   scope and final write-fence time. Verify the file/download and archive listing.
   A successful upload or `pg_restore --list` alone is not recovery proof
2. Restore into an independent disposable target, read tables and verify expected
   row counts, stable sentinel IDs, relationships, sequence values, extensions,
   roles/permissions and application queries. Compare against the same fenced
   snapshot, not a changing source. Never log table contents containing real data
3. For an existing managed Slipway backup, **Dock → Backups → Test restore**
   performs a bounded isolated restore. Its report proves that snapshot's
   checksum/connectivity/table-read checks, not the app's business invariants.
   Confirm the test completed and cleanup succeeded
4. Keep the source database, backup and recovery credentials accessible for the
   entire decision window. Validate the restore path separately from a backup
   status of `completed`. Record where the operator can recover; no secrets in
   this document or CI artifacts

## 4. Prepare source and deploy one app at a time

The following command forms match the repository CLI. They are operator examples,
not commands run by the automated rehearsal. Verify `slipway --version`, the
server URL and linked project before any mutation. Use the dashboard's secret
inputs for values; `db:create`, `db:url` and `env` may print connection values,
and `env:set` arguments can enter shell history.

```sh
slipway login --server https://slipway.example.test
# From each reviewed app checkout, initialize once OR link an existing project.
slipway init --name migration-atlas
# For an already-created project instead:
slipway link migration-atlas
slipway push
slipway readiness --env production --app web --json
slipway slide --env production --app web
slipway deployments --env production --limit 10
slipway logs --env production --app web --tail 100
slipway services --env production
slipway backup:create main-db --env production
slipway backup:list main-db --env production
```

Repeat with `migration-harbor` and `migration-beacon` in their own checkouts.
`push` has no `--env` flag. `slide` pushes again and deploys that returned source
revision. Record the actual deployed revision/commit and current configuration,
not only the earlier readiness preview. See
[source publication](source-publication.md) for isolation and interrupted upload
recovery, and [deployment readiness](deployment-readiness.md) for blockers,
advisories and invalidation. Add explicitly required variable names in
`package.json`; preserve `PORT=1337` and use a supported Node LTS runtime.

Configure each app's health path in App settings. Probe dependencies without
making business writes. Inspect the candidate probe and deployment outcome;
queued, source accepted, and old healthy-container status are not deployment
completion. A candidate must pass before traffic changes. Verify sufficient
memory/disk/ports to run the old and new processes together.

At the new target, for **each app**:

- Verify health and a read-only business request against the intended database
- **Bridge:** confirm the expected resources, open a seeded record, verify its
  stable ID/count and correct app scope. Hook presence alone is not Bridge
  configuration or authorization; use the [resource contract](bridge-resource-contract.md)
- **Helm:** execute a bounded read such as `await Sample.count()` using the actual
  fixture model. Confirm the selected app/datastore and expected count. Follow
  the [runtime contract](helm-runtime-contract.md); do not arm writes or dump
  `process.env`. A temporary lift must not run migrations or a second scheduler
- **Lookout:** send a benign request, confirm the current app/deployment's hook
  registration and fresh telemetry, then inspect errors/resource headroom. An old
  deployment's retained events are not proof that the new app is connected
- Confirm Redis session continuity or the agreed logout behavior. Run exactly one
  synthetic queue job with side effects disabled, then verify one completion and
  no residual delayed/retry work. Do not resume real jobs yet

## 5. Go/no-go and DNS/TLS

The operator records an explicit **go** only when all three apps pass:

- [ ] Exact source, lockfile, runtime, startup, health path and env-name inventory reviewed
- [ ] Backups verified by restoring; source preserved; recovery target and owner known
- [ ] PostgreSQL schema/data/permissions/sequence checks match the fenced snapshot
- [ ] Redis/session/queue plan verified; exactly one writer/consumer owner established
- [ ] Readiness blockers resolved; warnings reviewed; current candidate probes pass
- [ ] Bridge, Helm and Lookout checks pass for each intended app and database
- [ ] Host resource headroom, loopback/private bindings and ingress/firewall checked
- [ ] Old/new DNS records, TTL propagation window, TLS plan and old route retention agreed
- [ ] All shared/external writers are fenced if copying data; recovery decision owner available

Any unchecked item is **no-go**. Keep the old service available and the write
fence in place as appropriate; do not improvise by pointing both fleets at
diverging writable databases.

App deployment cutover changes a route inside Slipway. DNS/TLS moves traffic
between servers and can take longer. Follow [ingress](ingress.md) and
[routing failure recovery](routing-failure-recovery.md). Reduce TTL in advance
and wait out the **previous** TTL before depending on it. Account for A and AAAA,
CDN caches, long-lived connections and clients still reaching the old server.
Keep old ingress serving the agreed maintenance/read-only path during a data
move; a stale client must not revive writes to the source.

For a real approved cutover, set the hostname on the intended environment:

```sh
slipway environment:update production --domain atlas.example.test
slipway environments
```

Use real reviewed hostnames only in the operator's run. The `.test` rehearsal
names never request public DNS or certificates. In public mode, verify TCP 80/443
and Caddy's certificate challenges; in tunnel mode, verify the public hostname,
unchanged Host header, tunnel route and edge TLS. Check route selection for all
three names, HTTP-to-HTTPS behavior, certificate hostname/chain/expiry, and actual
HTTPS responses from an independent client after DNS changes. A route accepted
by Caddy does **not** prove public DNS propagation or certificate issuance.
There is no CLI certificate-inspection command.

After read-only checks on the new route, record the moment writes are deliberately
re-enabled and the first accepted target write/job. Monitor errors, session
behavior, queue ownership, telemetry freshness, data checks and resources through
the agreed observation/TTL window. Retire the source only after explicit operator
sign-off and retention/recovery requirements are met.

## 6. Rollback and interrupted work

**The database rollback boundary is the first new write on the target after the
final source snapshot, including jobs, migrations and background/external writers.**
Before that boundary, with the source still fenced and unchanged, a reviewed
route/connection rollback can resume from the source. After that boundary,
pointing back to the old database loses or forks writes: keep writers paused,
retain both databases/backups, identify new writes and reconcile them deliberately
(or fix forward). DNS rollback is not database rollback.

For an external-first app move, both versions still share the database. Rolling
back app code is safe only if current schema/data/session formats remain compatible.
App rollback does not undo migrations, env changes, queue effects or outside writes.
There is no rollback CLI command. Use the dashboard's available deployment
controls or redeploy the reviewed old source with explicitly reviewed configuration;
verify that the referenced image/source still exists and passes health checks.
Do not assume any historical deployment is automatically an eligible rollback.

Rehearse these failures only in disposable infrastructure:

| Failure/interruption                        | Required observation                                                                      | Recovery decision                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate health path returns 503           | Candidate fails; old traffic and current App remain on old release                        | Fix candidate/config, refresh readiness, deploy once; never remove the old healthy container to force success                                                       |
| Source upload fails or publisher stops      | Running containers unaffected; old validated source preserved or stale lock fails closed  | Follow source-publication recovery; inspect revisions/staging before retrying                                                                                       |
| Backup snapshot/download/checksum fails     | No destructive import; failed operation is visible                                        | Repair backup/storage and verify a new attempt; keep the write fence                                                                                                |
| Import fails                                | Source remains untouched when importing to a separate new target; target may be partial   | Inspect/discard only the disposable target. An in-place managed restore may mark its service failed; use its recorded safety snapshot deliberately                  |
| CLI/browser disconnects during restore      | Durable operation ID still identifies queued/running/terminal state                       | Refresh `/api/v1/restore-operations/:id` or service page; never submit another restore just because the response was lost                                           |
| Slipway restarts during import              | Running restore becomes `interrupted`, not automatically replayed                         | Keep writes paused, inspect target and snapshot, choose explicit recovery                                                                                           |
| Cutover interrupted before/after App commit | Deployment status/logs, current App and actual route/container identify the traffic owner | Inspect all three before acting. Coordinator contracts cover old-route recovery before commit and candidate finalization after commit; never replay business writes |
| Route rollback itself fails                 | Explicit routing error; success is not assumed                                            | Inspect Caddy and the actual served response before further changes                                                                                                 |
| New target has accepted writes              | Source/target no longer interchangeable                                                   | Pause, preserve both, reconcile or fix forward; do not blindly switch DB URLs                                                                                       |

## 7. Repeat the bounded rehearsal and record evidence

Use a clean repository checkout and test dependencies from its lockfile. No real
credentials, production Docker context, customer source or backup is needed.

```sh
node scripts/rehearse-coolify-migration.js
```

This runs three isolated **source/configuration fixtures** plus existing
readiness, source publication, cutover/coordinator, restore-operation and
Bridge/Helm/Lookout contracts. Runtime transports in those existing tests use
doubles where documented. It does not build/start three app containers, connect
a database, migrate Redis or change DNS. A pass is source/admission and contract
evidence, **not a successful three-app migration**.

For container evidence, on a dedicated disposable Docker runner with the pinned
local storage emulators and all required images already prepared:

```sh
SLIPWAY_MIGRATION_DISPOSABLE=1 node scripts/rehearse-coolify-migration.js --docker
```

The Docker stage reuses the real
[external PostgreSQL](../tests/contracts/external-postgresql.test.js),
[isolated stored-backup restore](../tests/contracts/restore-tests.test.js), and
[Caddy route recovery](../tests/contracts/custom-service-routes.test.js) contracts.
See [test prerequisites](../tests/README.md#coolify-migration-rehearsal).
These tests are disposable dependency/routing proofs, not three Sails apps moved
from Coolify. Public DNS/TLS, real Redis/session/queue continuity, app-side
PostgreSQL reads and the integrated three-running-app journey still require the
operator rehearsal above. Do not mark issue #640 complete from documentation or
an offline pass alone.

Record a sanitized evidence entry per gate:

| Gate                    | Record                                                                                                                 | Accept only when                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Source/contracts        | Checkout SHA, command, exit code, three fixture names                                                                  | All source and failure contracts pass                                    |
| Container dependencies  | Same SHA, CI run URL, image IDs, restore/route reports, cleanup result                                                 | Real isolated Docker contracts pass, no leftover owned resources         |
| Integrated three apps   | For each app: source revision, deployment ID, health result, DB counts, Bridge/Helm/Lookout result, Redis/queue result | All checks observed on disposable running Sails apps                     |
| Failure recovery        | Old-traffic response, failed-import source invariants, interrupted operation state/recovery, write-divergence decision | Each failure demonstrated without losing source data or replaying writes |
| DNS/TLS operator review | Route/hostname/TLS and propagation observations, writer-fence decision                                                 | Independently verified on the approved rehearsal infrastructure          |

Leave unrun gates explicitly **not run**, failures **failed**, and mocks/doubles
explicitly labeled. Save reports without secret values, raw environment output,
customer data or connection URLs. Evidence from a different commit is historical,
not verification of the current changes.

## Integrated disposable Linux rehearsal

The `Three running Sails apps migration proof` CI job owns the integrated
fixture in `tests/contracts/coolify-running-apps.test.js`. It starts three
synthetic Sails apps with both source and candidate instances, PostgreSQL,
Redis and a private Caddy proxy on a uniquely named local Docker network.
One app keeps an external-first PostgreSQL connection; two import reviewed
custom-format dumps into separate disposable databases. No restore writes to
an external database. The pinned PostgreSQL adapter is test-only and is not
added to Slipway's production dependencies.

The job exercises real Waterline data, Redis session/queue continuity, health
probes, Bridge workers, exact-runtime Helm evaluation, Lookout Docker metrics,
Caddy route cutover, pre-divergence rollback and interruption recovery. It
rejects a failed target health probe while old traffic works and a failed
import while source records remain intact. It then writes a disposable marker
to a target after cutover to prove why database rollback needs reconciliation.
No customer code, real jobs, public DNS, TLS issuance or production migration
runs. Public DNS/TLS and operational write-pause gates remain operator checks.

For a fresh Linux checkout with local Docker running, prepare the dependencies
and images explicitly before running the test:

```sh
npm ci --no-audit
npm install --prefix /tmp/slipway-migration-deps --ignore-scripts --no-audit --no-fund sails-postgresql@5.0.1
docker pull node:22-bookworm
docker pull postgres:17-alpine
docker pull redis:7-alpine
docker pull alpine
docker pull lucaslorentz/caddy-docker-proxy@sha256:f3ebe7e762bccf17ce38b88420f80ce63f69dc548eea0cd6e5f29db2ae2ea062
SLIPWAY_MIGRATION_DEPS=/tmp/slipway-migration-deps/node_modules node_modules/.bin/sounding test --file tests/contracts/coolify-running-apps.test.js --test-concurrency=1 --test-timeout=600000
```

The artifact `three-running-app-migration-proof` records the exact checked-out
head, fixture scope, per-app checks and completion status. A test definition or
partial artifact is not passing proof: require the job and all owning contracts
to pass on the PR head. The earlier offline/admission rehearsal remains useful
but does not independently establish that three apps ran.
