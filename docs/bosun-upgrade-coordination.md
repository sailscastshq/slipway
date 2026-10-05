# Pre-ORM upgrade coordination checkpoint

These modules are not connected to application startup, the updater, UI or CLI. No schema helper is retired and no release version is changed.

The release registry supplies immutable native SQLite catalogs and registered operations. Backup, clone preflight and live execution use the existing Bosun/Dock transaction engine. Every database commits its schema change and release receipt in one transaction. The coordinator reconciles actual receipts after interruption; it never assumes an expired lease proves the previous controller stopped and never restores an old snapshot over committed changes.

## Hard process bounds

`api/lib/upgrade-process.js` runs the fixed `upgrade-worker.js` with an explicit wall-clock budget, bounded IPC/output and a minimal environment. Operations are plan, backup, preflight, prepare, run, status and Linux writer observation. Inputs travel over IPC rather than command arguments. No caller-supplied SQL, executable, Sails lift, ORM or application jobs run in this worker.

On Linux, an independent guardian checks native process start identity and kills the worker group if the controller disconnects or the budget expires. It never authorizes a kill from a reused numeric PID. The supervisor kills its owned process group on timeout and waits for native exit before returning an error. This interrupts synchronous SQLite scans and DDL that cannot be bounded by an event-loop timer. A timeout does not imply rollback: the caller must inspect durable database receipts and the journal before resuming. Native tests prove both an uncommitted schema transaction rolls back and an already committed schema change survives a killed worker. Existing crash tests cover atomic receipts and a committed database ahead of the journal.

Fence and audit callbacks execute in the controlling process and must remain asynchronous and bounded. The supervisor supplies the actual child PID to those callbacks; native boot/start identity must be independently read before exempting that worker from a writer scan. The fixed workers do not launch other jobs or detached descendants. Authentication, cancellation and user-facing error/exit contracts remain caller integration work.

## Linux writer observation and exclusion boundary

`upgrade-writer-observer.js` requires a privileged Linux host observer and a trusted host PID namespace identity. It checks native boot/start process identity, device/inode identities of each database and existing WAL/SHM files, all visible host file descriptors and mappings, and actual Docker mounts/state. Relevant containers must be stopped, unpaused, not restarting and have restart policy `no`. Docker inventory and state are rechecked; unobservable processes or mounts fail closed. A controller may exempt only itself and its exact direct child migration worker.

The Linux CI fixture exercises actual SQLite/WAL writer processes, replacement processes, a writable mounted container, paused state, stopped containers with restart enabled, an unknown replacement container, and wrong namespace/start identities. It creates and removes only disposable local fixture resources.

Observation proves existing writers have stopped at the checkpoints. It cannot prevent a privileged actor from opening the database or launching a new container immediately afterward. The caller must separately enforce exclusive control of both Docker and host writer launch paths for the entire backup/preflight/DDL window. This observer intentionally does not return `exclusiveController`; a PID, local lock, Docker label or stopped-writer receipt is insufficient. Production exclusion and controller takeover remain unimplemented until the trusted launcher/control-plane contract is selected and proved.

## First upgrade remains a decision

The immutable 0.0.86/0.0.87 updater first validates a new image with shared database mounts while the old application is running. Its target-image sidecar later stops the old container, starts the new one and checks `/health`. On failure it unconditionally restarts the previous image. See the release-tagged `api/helpers/system/apply-update.js` and `api/helpers/system/build-update-swap-script.js`. Neither old caller understands a new migration flag or durable schema receipts.

A one-time host installer/CLI handoff is one option. A maintenance bridge is another option, not a selected implementation:

1. Both legacy validation and final target boot serve a restricted, authenticated maintenance surface. They perform no DDL, ORM migration or application jobs.
2. The bridge waits for positively observed completion of the old swap sidecar and removal of the previous container, closing the old unconditional rollback window.
3. An authenticated administrator starts the modern fenced controller. Ordinary readiness begins only after all native receipts and the journal agree.

Returning a maintenance health response must accurately distinguish maintenance from application readiness. Old health validation failure must remain safe to roll back because no DDL has happened. Starting DDL before the sidecar is gone, inferring completion from elapsed time, or enabling ordinary jobs before receipts complete could expose a migrated database to the old image. A bridge therefore needs container identity and rollback-window proofs, preserved session/auth behavior, restricted routes and explicit administrator intent. None of these capabilities should be assumed to exist in immutable old code.

Authenticated plan/status API and CLI contracts can be designed independently around exact instance, image digest and manifest identity. Their delivery process, authorization/session boundary, controller lifecycle, restart/resume behavior and startup health wiring depend on the chosen first-upgrade handoff. Those callers and activation remain pending; the internal entry guard is read-only and unwired.
