# Pre-ORM upgrade coordination checkpoint

The one-time host-side upgrade path for 0.0.86/0.0.87 to 0.0.88 is approved. This implementation checkpoint adds the host controller/driver and startup/readiness admission. It remains a draft: installer routing, future UI/CLI dispatch and final real-application release proofs are unfinished. No schema helper is retired and the package version remains 0.0.87.

The release registry supplies immutable native SQLite catalogs and registered operations. Backup, clone preflight and live execution use the existing Bosun/Dock transaction engine. Every database commits its schema change and release receipt in one transaction. The coordinator reconciles actual receipts after interruption; it never assumes an expired lease proves the previous controller stopped and never restores an old snapshot over committed changes.

## Hard process bounds

`api/lib/upgrade-process.js` runs the fixed `upgrade-worker.js` with an explicit wall-clock budget, bounded IPC/output and a minimal environment. Operations include plan, backup, preflight, prepare, run, status, private storage staging and Linux writer observation. Inputs travel over IPC rather than command arguments. No caller-supplied SQL, executable, Sails lift, ORM or application jobs run in this worker.

On Linux, an independent guardian checks native process start identity and kills the worker group if the controller disconnects or the budget expires. It never authorizes a kill from a reused numeric PID. The supervisor kills its owned process group on timeout and waits for native exit before returning an error. This interrupts synchronous SQLite scans and DDL that cannot be bounded by an event-loop timer. A timeout does not imply rollback: the caller must inspect durable database receipts and the journal before resuming. Native tests prove both an uncommitted schema transaction rolls back and an already committed schema change survives a killed worker. Existing crash tests cover atomic receipts and a committed database ahead of the journal.

Fence and audit callbacks execute in the controlling process and must remain asynchronous and bounded. The supervisor supplies the actual child PID to those callbacks; native boot/start identity must be independently read before exempting that worker from a writer scan. The fixed workers do not launch other jobs or detached descendants. Authentication, cancellation and user-facing error/exit contracts remain caller integration work.

## Linux writer observation and exclusion boundary

`upgrade-writer-observer.js` requires a privileged Linux host observer and a trusted host PID namespace identity. It checks native boot/start process identity, device/inode identities of each database and existing WAL/SHM files, all visible host file descriptors and mappings, and actual Docker mounts/state. Relevant containers must be stopped, unpaused, not restarting and have restart policy `no`. Docker inventory and state are rechecked; unobservable processes or mounts fail closed. A controller may exempt only itself and its exact direct child migration worker.

The Linux CI fixture exercises actual SQLite/WAL writer processes, replacement processes, a writable mounted container, paused state, stopped containers with restart enabled, an unknown replacement container, and wrong namespace/start identities. It creates and removes only disposable local fixture resources.

Observation proves existing writers have stopped at the checkpoints. It cannot prevent a privileged actor from opening the database or launching a new container immediately afterward. The caller must separately enforce exclusive control of both Docker and host writer launch paths for the entire backup/preflight/DDL window. This observer intentionally does not return `exclusiveController`; a PID, local lock, Docker label or stopped-writer receipt is insufficient. The new privileged host driver supplies the managed-launch exclusion contract: a root-owned instance lock, stopped old containers with restart disabled, private staged storage and native startup admission. Raw privileged Docker/root access remains the trusted host administration boundary. This does not claim to sandbox a competing privileged host administrator. Linux fixture confirmation and complete application-path proofs remain release gates.

## Approved first upgrade: one-time host command

The immutable 0.0.86/0.0.87 updater first validates a new image with shared database mounts while the old application is running. Its target-image sidecar later stops the old container, starts the new one and checks `/health`. On failure it unconditionally restarts the previous image. See the release-tagged `api/helpers/system/apply-update.js` and `api/helpers/system/build-update-swap-script.js`. Neither old caller understands a new migration flag or durable schema receipts.

The selected path is the one-time host command. A maintenance bridge remains a documented alternative, not an implemented or selected path:

1. Both legacy validation and final target boot serve a restricted, authenticated maintenance surface. They perform no DDL, ORM migration or application jobs.
2. The bridge waits for positively observed completion of the old swap sidecar and removal of the previous container, closing the old unconditional rollback window.
3. An authenticated administrator starts the modern fenced controller. Ordinary readiness begins only after all native receipts and the journal agree.

Returning a maintenance health response must accurately distinguish maintenance from application readiness. Old health validation failure must remain safe to roll back because no DDL has happened. Starting DDL before the sidecar is gone, inferring completion from elapsed time, or enabling ordinary jobs before receipts complete could expose a migrated database to the old image. A bridge therefore needs container identity and rollback-window proofs, preserved session/auth behavior, restricted routes and explicit administrator intent. None of these capabilities should be assumed to exist in immutable old code.

## Host command checkpoint

`scripts/upgrade-host.sh` accepts `plan`, `apply`, `status` and `resume` with a pinned official OCI image digest. Apply/resume require the exact instance and plan hash; source container and checkpoints are bound to native identities. The command is Linux/root only. Its target-image program receives private JSON on stdin. It requires a coordinated release image whose package version matches the shipped registry, so the current 0.0.87 package cannot silently serve as an 0.0.88 upgrade image.

The controller stops the reviewed old container with restart disabled. It checks physical writers, copies the complete original storage privately (including sessions and opaque keys), verifies byte hashes and source stability, makes the mandatory four-database backup set, runs clone preflight and applies the shared engine to staged storage. Original storage is never migrated in place. A late original write blocks publication. Backups and both storage trees are retained after failure.

Publication uses structured Docker API bodies to preserve existing session/encryption values without placing them on argv. It retains the reviewed mounts, network, ports, resource/security settings and target image entrypoint, and fails closed for unsupported topology. The candidate starts only with completed native receipts. Container creation is reconciled by run labels after interruption; failed readiness holds/stops the candidate and leaves a resume checkpoint. It never automatically restarts an old image against migrated storage.

Main startup checks admission before requiring Sails. Sails CLI configuration and a configure hook recheck actual datastore device/inode identities before ORM initialization and require safe ORM mode. Annotated readiness is bound to the exact image/instance/manifest; drift returns 503. Existing unannotated 0.0.87 development/production fixtures remain compatible while the coordinated release gate is unfinished.

The founder handoff is short-lived, signed using the existing session secret, bound to one instance/plan and durably replay-protected. It rechecks native founder authority/authentication version and rejects password rotation, revoked authority, deletion, expiry, wrong plans and replay. Host-only recovery uses the existing root administration authority. No new production credentials are created.

Still required before shipping: installer/fresh-install routing, future authenticated UI/CLI dispatch, prior-release-ledger transitions, actual released-image startup/session/failure proofs, all managed worker entry/stop contracts, and helper retirement proof preserving business backfills/readiness/recovery. The maintenance bridge is not selected. No production upgrade, merge or release has run.
