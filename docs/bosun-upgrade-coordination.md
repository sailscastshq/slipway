# Pre-ORM upgrade coordination checkpoint

The one-time host-side upgrade path for 0.0.86/0.0.87 to 0.0.88 is approved. The draft implements a transient native Linux/root command, verified host packaging, installer routing and read-only UI review/status. Final exact-head Linux proof remains required. Coordinated helper retirement is implemented with native admission and catalog contract coverage; the package version remains 0.0.87.

The release registry supplies immutable native SQLite catalogs and registered operations. Backup, clone preflight and live execution use the existing Bosun/Dock transaction engine. Every database commits its schema change and release receipt in one transaction. The coordinator reconciles actual receipts after interruption; it never assumes an expired lease proves the previous controller stopped and never restores an old snapshot over committed changes.

## Hard process bounds

`api/lib/upgrade-process.js` runs the fixed `upgrade-worker.js` with an explicit wall-clock budget, bounded IPC/output and a minimal environment. Operations include plan, backup, preflight, prepare, run, status, private storage staging, bounded host visibility precheck and Linux writer observation. Inputs travel over IPC rather than command arguments. No caller-supplied SQL, executable, Sails lift, ORM or application jobs run in this worker.

On Linux, an independent guardian checks native process start identity and kills the worker group if the controller disconnects or the budget expires. It never authorizes a kill from a reused numeric PID. The supervisor kills its owned process group on timeout and waits for native exit before returning an error. This interrupts synchronous SQLite scans and DDL that cannot be bounded by an event-loop timer. A timeout does not imply rollback: the caller must inspect durable database receipts and the journal before resuming. Native tests prove both an uncommitted schema transaction rolls back and an already committed schema change survives a killed worker. Existing crash tests cover atomic receipts and a committed database ahead of the journal.

Fence and audit callbacks execute in the controlling process and must remain asynchronous and bounded. The supervisor supplies the actual child PID to those callbacks; native boot/start identity must be independently read before exempting that worker from a writer scan. The fixed workers do not launch other jobs or detached descendants. The fixed native host entrypoint is itself supervised; every nested worker is registered before it receives work.

## Linux writer observation and exclusion boundary

`upgrade-writer-observer.js` requires a privileged Linux host observer and a trusted host PID namespace identity. It checks native boot/start process identity, device/inode identities of each database and existing WAL/SHM files, all visible host file descriptors and mappings, and actual Docker mounts/state. Relevant containers must be stopped, unpaused, not restarting and have restart policy `no`. Docker inventory and state are rechecked; unobservable processes or mounts fail closed. A controller may exempt only itself and its exact direct child migration worker.

The Linux CI fixture exercises actual SQLite/WAL writer processes, replacement processes, a writable mounted container, paused state, stopped containers with restart enabled, an unknown replacement container, and wrong namespace/start identities. It creates and removes only disposable local fixture resources.

Observation proves existing writers have stopped at the checkpoints. It cannot prevent a privileged actor from opening the database or launching a new container immediately afterward. The caller must separately enforce exclusive control of both Docker and host writer launch paths for the entire backup/preflight/DDL window. This observer intentionally does not return `exclusiveController`; a PID, local lock, Docker label or stopped-writer receipt is insufficient. The new privileged host driver supplies the managed-launch exclusion contract: a root-owned instance lock, stopped old containers with restart disabled, private staged storage and native startup admission. Raw privileged Docker/root access remains the trusted host administration boundary. This does not claim to sandbox a competing privileged host administrator. Complete actual-image and exact-head CI proofs remain release gates.

## Approved first upgrade: one-time host command

The immutable 0.0.86/0.0.87 updater first validates a new image with shared database mounts while the old application is running. Its target-image sidecar later stops the old container, starts the new one and checks `/health`. On failure it unconditionally restarts the previous image. See the release-tagged `api/helpers/system/apply-update.js` and `api/helpers/system/build-update-swap-script.js`. Neither old caller understands a new migration flag or durable schema receipts.

The selected path is the one-time host command. A maintenance bridge remains a documented alternative, not an implemented or selected path:

1. Both legacy validation and final target boot serve a restricted, authenticated maintenance surface. They perform no DDL, ORM migration or application jobs.
2. The bridge waits for positively observed completion of the old swap sidecar and removal of the previous container, closing the old unconditional rollback window.
3. An authenticated administrator starts the modern fenced controller. Ordinary readiness begins only after all native receipts and the journal agree.

Returning a maintenance health response must accurately distinguish maintenance from application readiness. Old health validation failure must remain safe to roll back because no DDL has happened. Starting DDL before the sidecar is gone, inferring completion from elapsed time, or enabling ordinary jobs before receipts complete could expose a migrated database to the old image. A bridge therefore needs container identity and rollback-window proofs, preserved session/auth behavior, restricted routes and explicit administrator intent. None of these capabilities should be assumed to exist in immutable old code.

## Transient native host command

`scripts/upgrade-host-native.sh` accepts `verify`, `plan`, `apply`, `initialize`, `status` and `resume`. Every invocation requires a separately verified archive path and SHA-256. Image operations require an official immutable OCI digest. Apply/resume require exact `--instance` and `--approve-plan`; status/resume bind the saved checkpoint and image. The command runs once as Linux host root and exits. It installs no service, broker or security-policy exception.

Build the versioned Linux bundle with `scripts/build-upgrade-host.sh <output.tar.gz> <exact-source-sha>`. The builder pins its Debian Node image by digest, installs Linux dependencies in an isolated build context and packages the shared production controller/engine plus Node and native SQLite. Packaging rejects a source version that does not match the coordinated registry (0.0.88); this branch remains 0.0.87. The manifest records exact source revision, builder digest, architecture, Node module ABI, libc minimum and every payload hash. Official release asset publication and checksum distribution remain a coordinated release gate; no assets have been published by this draft.

The launcher snapshots the archive privately before extraction, verifies its supplied checksum, rejects links/traversal/duplicates and bounds file count and bytes. It checks the complete file inventory, host architecture/libc, Node ABI and native SQLite integrity before Docker or datastore operations. Extraction is private and temporary. The candidate image must match the bundle source revision label, immutable digest and registry package version. Release metadata now records the checked-out source revision, including manually selected release tags.

Example after independently verifying the release archive/checksum:

```sh
sudo bash scripts/upgrade-host-native.sh plan \
  --bundle /reviewed/slipway-host.tar.gz --bundle-sha256 <verified-sha256> \
  --image ghcr.io/sailscastshq/slipway@sha256:<reviewed-image-digest>
```

Review the returned native instance and plan hash, then invoke `apply` with those exact values. A failure retains its private checkpoint; invoke `resume` with `--checkpoint`, the same instance/hash and the same image/archive. `--ndjson` emits an accepted checkpoint before work and a final machine result; JSON is the default. Recovery/timeout/interruption exits unsuccessfully and never implies rollback.

The whole native controller has a hard outer process deadline and SIGINT/SIGTERM cancellation. Independent detached guardians supervise the outer worker and nested SQLite workers. Child boot/start identities are registered and checked before work. Interruption kills owned process groups and waits for native stop; PID reuse cannot authorize a kill. SIGKILL disconnects guardians, which reap surviving workers. The command reuses `upgrade-host-program`, `upgrade-host-controller`, `upgrade-host-driver` and the existing transaction/receipt engine; there is no alternative migration runner.

The controller disables source restart, positively observes stopped writers and stages the complete storage privately, including sessions and opaque keys. It validates the reviewed physical catalog on that copy, performs four mandatory backups and clone preflight, and migrates only staged storage. Original storage byte changes block publication. Failure keeps source, backups and staged storage; failed target health stops the candidate and exact resume reconciles the existing target. Container settings and secrets travel in structured Docker API bodies. Startup/readiness require exact image/manifest/native receipts before ORM or jobs. Prior transitions validate all historical receipts and bind their predecessor. Fresh installs use the same engine after rejecting existing catalogs, sessions, opaque files and symlinks.

All 18 coordinated schema helpers check native admission and datastore bindings before retaining only their existing business repairs. Legacy unannotated 0.0.87 behavior remains compatible. This does not bypass table/index/trigger/view admission.

## UI, API and installer first slice

The settings UI reviews a pinned host command and displays saved status/recovery. It requires a separately verified archive/checksum and a native host plan; it does not invent approval hashes. Automatic UI execution is disabled. Both REST and Inertia apply/resume requests return neutral host-required errors without starting helpers. Status only reads the bound trusted checkpoint. The existing founder authorization policies still protect all routes. The old container transport remains compatibility code, not the runtime dispatch path.

The installer detects coordinated releases before proxy/configuration changes. Existing installations receive a native review command and exit before mutation. Fresh initialization requires `SLIPWAY_HOST_BUNDLE` and `SLIPWAY_HOST_BUNDLE_SHA256`, verifies host compatibility first, creates a never-started labeled template and invokes native `initialize`. It never enters legacy shared-storage validation or rollback.

Remote CLI upgrade commands continue to provide machine JSON/NDJSON/error behavior, but automatic remote apply/resume are blocked by the same host-required response. A future authenticated native dispatch boundary needs separate coordination; this draft creates no general root command socket or resident service.

## Disposable proof and release gates

The Linux actual-image gate builds a scratch 0.0.88 image and matching verified Debian host bundle without changing repository version. It uses native root host observation with ordinary container profiles. The fixture covers released 0.0.87 session/encrypted storage, failed target health and exact resume, worker startup denials and a fresh setup. Additional contracts cover whole-process deadlines, SIGINT/SIGKILL, committed/uncommitted SQLite preservation, archive corruption and incompatible ABI. Catalog diagnostics inspect private copies and assert the original source hash is unchanged; SQLite read-only catalog connections can alter WAL shared-memory sidecars.

No AppArmor exception is in the production launcher or current fixture. `docs/root-observer-profile-proposal.patch` is archived, unapplied history. The previous container path failed closed before staging under default confinement; that historical failure does not describe the new native path. No production command, upgrade, service installation, merge or release has run. Official host artifact publication and final exact-head CI remain release gates.

### Bounded fixture experiment and remaining catalog evidence

The explicitly approved fixture-only experiment at `ab1462b139ffc62f3fa3842018f2454e6035d320` changed only the full-image test controller's AppArmor setting. Its immutable evidence is [job 112046082448](https://github.com/sailscastshq/slipway/actions/runs/37394180821/job/112046082448): host `/proc` reads and writer observation passed, and actual-image fresh initialization passed. Existing-image adoption stopped with `upgradeUnsupportedSchema` before retaining staged storage. The log did not retain the underlying SQLite error or physical catalog diff, and fixture cleanup removed the database; an exact mismatched table/index cannot be inferred from that code. The experiment is now removed; no further unconfined run is authorized.

Native reproduction demonstrates a separate legitimate read defect: after the final WAL writer closes, SQLite can need transient sidecars even for a read-only catalog connection. A read-only source directory returns a native read error without any catalog drift. Post-stop revalidation now reads a byte-verified private copy, while retaining the original directory device/inode, exact reviewed manifest and historical receipt checks. A rejected catalog removes the unapproved copy. This is not evidence that the missing CI catalog fact has been recovered, and it does not allow unknown tables, indexes, triggers or views.
