# Slipway 0.0.90 — verified storage, safer deployments, and dependable Quest runs

Slipway 0.0.90 completes the storage recovery and deployment safeguards prepared after 0.0.89, strengthens secret handling across the dashboard and APIs, and verifies the published package pair for Quest's typed invocation, structured results, live output and recovery controls.

This release includes #719/#720, #717/#721, #718/#722, #647/#723 and #653/#725. The only remaining open issue at release preparation is #724, tracking two unpatched dependency advisory families explicitly accepted for 0.0.90.

## Storage: consistent SQLite libraries, verified snapshots and explicit recovery

- Select **better-sqlite3 12.11.1 / SQLite 3.53.2** consistently across the application, ORM, sessions, cache and migration/snapshot tools. An override prevents older transitive runtime copies from remaining alongside the selected library.
- Verify native SQLite backups of **all four management datastores** before updates: `app.db`, `observability.db`, `analytics.db` and `stash.db`. Each snapshot passes integrity and foreign-key checks; private manifests retain file sizes, timestamps and SHA-256 hashes.
- Send the resulting private archive through the existing adapter-neutral backup pipeline when remote backup storage is configured. Local verification failure blocks an update; remote unavailability leaves an explicit warning and retained verified local copies.
- Add a bounded daily database-health job at **03:00 UTC**. Native checks run in an isolated child process, avoiding blocking the dashboard event loop. The private health report distinguishes failure, timeout and incomplete evidence.
- Allow five minutes for migration work and six minutes for updated validation/swap health checks. Lock waits remain bounded. Synchronous native SQL is checked at phase boundaries; this is not an interruptible query guarantee.
- Provide an explicit offline recovery flow with a fresh stopped-writer whole-volume snapshot, strict application row/schema parity, private preservation of salvage evidence, migration preflight on a second copy, staging of original-schema candidates, and health-verified restart/rollback with matching journals.
- Reset observability only with the operator's explicit acknowledgement. Ambiguous application rows are refused; the tool never chooses a winner with `INSERT OR REPLACE`. Ordinary failures and trapped interruptions retain originals. An interruption marker guards incomplete replacement; whole-host failures or SIGKILL can bypass shell cleanup.

**Scope:** these are Slipway's management databases, separate from deployed applications' databases. This release does not establish the cause of a particular corruption incident, repair arbitrary corruption automatically, or guarantee lossless salvage. Online snapshots are individually consistent, not one cross-database transaction. A stopped whole-volume snapshot is the system recovery boundary and also preserves keys and other non-registry files. System backups contain sensitive data and must remain private. Retention of those backups is operator-managed.

See [SQLite verification and recovery](https://github.com/sailscastshq/slipway/blob/v0.0.90/docs/sqlite-recovery.md).

## Deployment: respect host ports already published by Docker

The allocator now includes Docker's host publications rather than relying only on container-local application records. This prevents a new deployment from choosing a host port already owned by another container, including the collision blocking Hagfish.

IPv4/IPv6 bindings and published ranges are considered through a bounded inventory snapshot. Unreadable or invalid allocation evidence fails closed. The change is server-side; no CLI upgrade is required for the port fix. Contract coverage and a real Docker test prove an owned port is skipped rather than reused.

## Security: redact secrets by default, reveal deliberately

- Use explicit public projections for application, environment, service and deployment API responses. Environment values are hidden by default; values explicitly declared plain may remain visible.
- Preserve hidden stored values when masked forms or CLI edits are submitted. Explicit rename mappings avoid accidentally replacing a secret with its display placeholder.
- Add an authorized configuration-reveal route. Reveals are bound to the actor and active team, use private/no-store responses, and require value-free audit recording; inability to record the audit fails closed.
- Apply bounded redaction to JSON, Inertia/SSR data, SSE/log streams, diagnostic output and new retained diagnostic records. This includes recognized configuration credentials, encrypted fields and supported encodings. Shared catalogue reads are bounded rather than growing with every viewer.
- Handle UTF-8 and secrets crossing chunk boundaries in deployment/build and Helm output. Oversized unprocessable lines are withheld, and output flushing is sequential and bounded.
- Keep clean public R2/S3/Spaces image origins usable without exposing credentials, query strings or fragments.

Redaction is defense in depth, not permission control or a guarantee that arbitrary application data is safe to log. Authorized capability issuance and binary backup/export payloads retain their intended behavior. Unknown app-only secrets or deliberately transformed values may be outside the catalogue. Previously exposed credentials still require rotation; historical stored data is not silently rewritten.

**CLI:** source for CLI 0.0.4 is prepared, including defensive output handling and explicit database-URL reveal. The server image does **not** publish that npm package. Existing CLI callers receive the server's safer API responses, while new CLI-specific reveal behavior requires a separately published/installed compatible CLI.

## Quest: review inputs, see business results, recover evidence without repeating work

Quest remains the scheduler for the Sails scripts in an app. Slipway provides the operational workspace; it does not introduce a second scheduler or a separate place to author business logic.

The verified rollout provides:

- Typed input review from supported Sails script metadata, including required fields, defaults, enums and bounds. `false`, `0`, omitted values and `null` retain their distinct meanings. Final validation stays in the app; invalid admission starts no process.
- Result-first run details: scalar/tree/table business values are separate from stdout, stderr, process exit codes and named exits. Successful processes can still have warnings; JSON-looking logs cannot impersonate a business result.
- Stable run IDs and links, paginated lightweight history, idempotent event ingestion and monotonic state. Reopening a run reads its retained evidence.
- Authoritative resident scheduling, pause and overlap behavior. Inspection starts no extra Sails scheduler. Deployment/runtime identity and app/team ownership are verified before controls are offered.
- Capability-gated live output with bounded tails, replay gaps, shared scoped reads, subscriber cleanup and explicit disconnected/unconfirmed states. Closing the page does not cancel execution.
- Owned-process cancellation on supported Linux runtimes. Cancelling becomes Cancelled only after verified termination; uncertain ownership, timeout or escaped descendants remain Unconfirmed. External side effects may already have happened.
- Optional bounded private receipt delivery across dashboard outages. Retries deliver evidence only; they never repeat a business job. Exact-content acknowledgement and sequence checks protect terminal state against duplicated or delayed deliveries.
- Deliberate Run again review against the current deployment/schema. Secret inputs are excluded from rerun defaults. Unknown outcomes are never automatically retried.

### App upgrade and opt-ins

The tested published pair is **sails-hook-quest 0.0.8 + sails-hook-slipway 0.0.13**. Commit app lockfile changes, rebuild and redeploy the app. Updating the dashboard alone cannot grant runtime capabilities, and installation alone does not enable app-owned controls.

For supported Linux controls, opt in through app source:

```js
module.exports.quest = { runtimeControls: true }
```

For Quest integration and optional durable receipts:

```js
module.exports.slipway = {
  quest: {
    enabled: true,
    delivery: { directory: '/app/data/quest-receipts-APP-DEPLOYMENT' }
  }
}
```

The directory must be private, persistent, owned by the app UID with mode **0700**, unique to the app/deployment, and have exactly one resident writer. Receipt files are **0600**. Replicas need separate directories. Current spool limits are **256 receipts / 4 MiB**, **32 KiB per event**, seven-day retention, and at most eight receipts per ten-second retry. Expiry, full storage, unavailable disks or loss of the deployment directory can lose evidence and are disclosed.

Older hooks remain explicitly limited. Cancellation can be unavailable on macOS/Windows or when Linux ownership evidence cannot be verified. Pause/overlap are process-local; this is not a distributed queue, durable cross-replica lock, automatic catch-up mechanism, or exactly-once guarantee.

See [rollout and limits](https://github.com/sailscastshq/slipway/blob/v0.0.90/docs/quest-milestone-c.md).

### Verified runtime and performance evidence

The final source checkpoint is `2d54b82e6af94e62f8ad4b7233ee72c4f688fc4d`. CI exercises both exact source-packed and actual npm-installed consumers. Registry verification checks archive SHA-512 against npm metadata, every packaged source file, installed lock URLs/integrity and the consumer dependency tree.

Both real Sails/Docker/browser variants pass typed input/result parity, resident pause/overlap, ownership and cancellation, and actual disk-backed dashboard restart with HTTP telemetry. Each restart fixture preserves **36 large results**, accepts **80 telemetry events**, starts **zero additional jobs through recovery delivery**, and confirms cleanup of three owned processes and runtime registry entries. The registry fixture sends 724,985 bytes across five accepted requests; the packed fixture sends 802,475 bytes across six. These are synthetic fixtures, not customer jobs or production traffic.

All **76 UI state captures** were reviewed across desktop/mobile and light/dark themes, including required-field validation, running, disconnected, legacy, cancellation, structured results, edited rerun and keyboard use.

Measured tradeoffs are retained:

| Measurement                    |     Earlier path | Current path | Scope                                                                          |
| ------------------------------ | ---------------: | -----------: | ------------------------------------------------------------------------------ |
| Initial history JSON           | 32,865,408 bytes |  4,451 bytes | Synthetic 500-event, log-heavy fixture; logs fetched separately                |
| History read median            |        62.583 ms |    17.647 ms | Seven alternating warmed in-memory SQLite samples; excludes JSON serialization |
| Cold page ready, desktop light |        110.20 ms |    112.60 ms | Production-built assets, ten samples per phase/viewport                        |
| Cold page ready, desktop dark  |        107.20 ms |    113.85 ms | Same bounded fixture                                                           |
| Cold page ready, mobile light  |        108.65 ms |    117.40 ms | Same bounded fixture                                                           |
| Cold page ready, mobile dark   |        108.35 ms |    113.05 ms | Same bounded fixture                                                           |

The fuller workspace adds **57,908 bytes** of JS/CSS in this comparison. Same-source preload on/off observations improve ready medians by approximately **4.8–11.6 ms** without changing requested asset bytes, but do not eliminate the original-page byte or latency increase. This release makes no universal speedup or original-page non-regression claim.

## Dependency audit

The scoped sockets override selects patched **proxy-addr 2.0.8** beneath `sails-hook-sockets`, using the same installed version as Express. Receiver-level tests cover trust modes and the malformed mapped-IPv6 advisory regression. Production's existing reverse-proxy trust policy is unchanged.

The fresh audit improves **9 → 7 reported entries** and **2 → 0 critical entries**. The remaining four high and three moderate entries represent **two underlying advisories**: braces through Shipwright/fast-glob/micromatch, and sprintf-js through Sails/i18n-2. No compatible published patch was available in the reviewed registry state. The maintainer accepted these two families for **0.0.90 only**, with repository-owned glob/format inputs and continued follow-up in [#724](https://github.com/sailscastshq/slipway/issues/724). They are unresolved; the audit is not clean. Forced framework downgrades are not treated as fixes.

## Validation and updating

The final Quest PR passed the complete exact-head suite: **700 unit tests**, **200 functional tests**, every browser shard and aggregate, native SQLite recovery/rollback and previous-release upgrades, packaged production boot, migrations against SQLite/PostgreSQL/MySQL and running Sails apps, host-port allocation, storage/Bearing, Helm, and both Quest package/runtime variants. Release publication runs the full verification workflow again before building and pushing the tagged Docker image, including packaged Helm/Wake import checks.

Use Slipway's normal update flow once the release image is published. This release retains integrity checks; it does not bypass an already-corrupt database. An older running updater retains its older timeout until it has been upgraded. Keep verified private remote management backups and use the documented offline path only when integrity evidence requires it.

Customer app dependencies and the separately distributed CLI are not automatically upgraded by the dashboard release.

**Full comparison:** https://github.com/sailscastshq/slipway/compare/v0.0.89...v0.0.90
