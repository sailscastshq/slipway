# SQLite verification and operator recovery

Slipway owns four management datastores: `app.db`, `observability.db`, `analytics.db`, and `stash.db`. They are separate from deployed applications' databases. Corruption in management storage can break dashboard operations or block an update without proving that deployed app data is damaged. An update must not bypass integrity checks, silently reset management data, or automatically salvage ambiguous rows.

## Prevention and early detection

Slipway explicitly depends on better-sqlite3 12.11.1 and overrides transitive copies to that same version. ORM, sessions, cache, migration helpers and snapshot workers therefore use the same SQLite 3.53.2 library. Previous dependency ranges installed an older root library alongside a newer ORM library. SQLite documents a rare concurrent WAL write/checkpoint corruption bug affecting releases through 3.51.2, fixed in 3.51.3 and later: https://sqlite.org/wal.html#walresetbug. The old library was exposed to that class of defect; this alone does not establish the cause of any installation's corruption.

The daily `check-system-databases` Quest job runs at 03:00 UTC. It uses an isolated, five-minute-bounded child process to make native SQLite snapshots and fully verify them, one database at a time. Native checks do not block the dashboard's event loop. It stores a private `db/database-health.json` report, logs an actionable failure, and uses the existing job-failure notification preferences and transports. A timeout means an incomplete check, not proof of corruption. Free-space and per-file size limits apply; large checks still consume disk bandwidth and CPU. Snapshots are removed after checks. This job is detection, not repair. It requires a running scheduler; damage preventing Sails/Quest startup can also prevent this notification, so external health monitoring remains necessary.

Before updates, Slipway retains snapshots of all four datastores under `db/system-backups/<unique-id>`. Each native backup must pass full integrity and foreign-key checks before the update proceeds. The private manifest includes per-file SHA-256, bytes and snapshot times. A `.tar.gz` bundle goes through the existing adapter-neutral private backup pipeline when remote storage is configured. A failed local snapshot blocks the update; unavailable remote storage leaves an explicit warning and verified local copies. Local backups cannot protect against losing the entire host: configure private remote backup storage.

The online bundle excludes `session.db`, keys, and other non-registry files; the whole-volume cold snapshot preserves them.

These snapshots are individually consistent SQLite backups, **not a single cross-database transaction**. A stopped whole-volume snapshot is required for exact system recovery across datastores and non-database files such as keys. Retained system snapshots are not automatically pruned: validate a remote recovery copy, then apply an operator retention policy. Snapshot bundles contain sensitive management data and must remain private. Existing standalone pre-update `.db` backups remain standalone files; new bundles are identified by `.tar.gz` plus `manifest.json`.

## Update deadlines

Migration preparation and application have a five-minute cooperative deadline, with lock waits still bounded at five seconds. Updated validation and swap health windows are six minutes, allowing Sails lift after migration. Long synchronous native SQL calls are not interrupted mid-call; the budget is checked at phase boundaries and backup progress callbacks. The five-minute operator worker timeout is a hard process bound.

An already-installed older updater still has its old health window. A new image cannot change code already running in that older server. Use the offline preparation command below on candidate copies, or reset disposable observability history through the explicit recovery flow, then retry the normal update. Do not report preflight as normal application readiness. Registry version/checksum remain immutable and independent of the application release version.

## Explicit recovery with observability reset

Recovering `app.db` is different from discarding observability history. Recovery must prove complete row and schema parity for all readable application tables, sequences, custom views, triggers, and indexes. A structurally valid salvage file alone is not enough. Unreadable or differing application tables require investigation or a verified healthy backup; this flow refuses them. Unassigned salvage rows and generated SQL are retained privately for inspection. Observability reset discards logs, metrics, telemetry, Quest run history and related observability state in the candidate only. It preserves the captured schema, including custom objects. Analytics and cache snapshots are verified and preserved.

Use a Linux server with a local Docker daemon, root access, `fuser`, and an explicitly obtained native SQLite recovery CLI with DBPAGE and STAT4 support. Many distribution CLIs cannot execute `.recover` because DBPAGE was omitted. Use a checksum-verified official SQLite build; never download an unverified executable. A CLI supplied only for offline salvage is separate from Slipway's application runtime library.

Pull and inspect the chosen Slipway image **before** downtime. Keep `bin/recover-slipway.sh` and `bin/slipway-database.cjs` together from the same reviewed revision. The image must contain the compatible release migration engine. The command requires explicit acknowledgement of resetting observability:

```bash
bash bin/recover-slipway.sh IMAGE /absolute/path/sqlite3-recovery --reset-observability
```

The flow:

1. Requires the current `slipway` container to be running and finds its `/app/db` host mount. Saves its inspection privately without changing the container configuration.
2. Stops only Slipway, rejects overlapping Docker writers and host processes holding the owned databases open, then copies the complete cold volume into a unique private recovery directory. Deployed application containers are not stopped.
3. Recovers `app.db` with `.recover --ignore-freelist`, validates full integrity/foreign keys, and compares all application rows and native objects. Never uses `INSERT OR REPLACE` to choose between conflicting records.
4. Rebuilds empty observability from the captured schema, verifies analytics/cache snapshots, then validates actual release migration and receipts on a **second disposable copy**.
5. Stages the original-schema candidates and retains untouched originals and journals. Replaces only the four owned databases while writers are stopped, then restarts the existing container with its existing configuration. It installs the original-schema candidates, not the migrated test copies, keeping the older server compatible for the normal update.
6. Requires application health. On an ordinary failure or trapped interruption, stops the candidate writer, quarantines failed files, restores originals with their matching journals and restarts Slipway. It never restores an old snapshot while the server is still writing.

Never install a recovery copy after restarting the original server and allowing new writes. The wrapper takes its own fresh snapshot during the bounded operation rather than using an earlier diagnostic snapshot. Schedule a maintenance window, suspend external writers, and prevent dashboard traffic until recovery finishes. Whole-host failure or SIGKILL can bypass shell traps; originals remain available. The interrupted-recovery marker blocks updated startup during replacement; it is cleared only after all four files have been installed and flushed, before starting the server. A crash after that point leaves a complete installation, but its health still needs verification.

## Interrupted replacement

Keep Slipway stopped. Read the private `.slipway-recovery-in-progress` marker to locate retained originals. Preserve current failed files first, then restore the four original database files **together with their matching `-wal`, `-shm`, and `-journal` files** from that recovery directory while no writers have access. Remove the marker only after the originals are fully restored and reviewed. Restart the original container. Do not discard or mix journal files, overwrite live files, rerun recovery over a partially installed set, or expose the private container inspection, recovery SQL or salvage evidence in public issue reports.

SQLite's backup API provides consistent snapshots, but does not repair an already-corrupt source. Integrity checks and journal discipline remain necessary: https://sqlite.org/backup.html and https://sqlite.org/howtocorrupt.html.

## Audit findings and limits

The pre-update helper already used SQLite's backup API, rather than a raw copy of a live database. Its gaps were single-datastore coverage, missing snapshot integrity verification, and treating backup failure as non-blocking. Migration snapshots already had integrity verification and retained rollback data. The audit also found duplicate native library versions; no specific corrupting write, unsafe system restore or hardware cause has been established. Existing single-writer checks at migration startup remain in place. Application service restores operate on customer databases and remain a separate path.

Testing uses disposable databases and Docker containers, including corrupt planner/index pages, application parity refusal, observability reset, retained archive contents, immutable migration receipts, restart and failed-recovery rollback. Passing these checks establishes behavior on those fixtures, not proof that an arbitrary damaged application database can be recovered without loss.
