# Shared Slipway updater

The settings page, account-menu modal and the existing-installation branch of `install.sh` call `bin/slipway-updater.cjs`. The entry points observe one detached engine; the terminal interface is not embedded in the web app. Fresh installation still performs host setup. Existing-installation updates do not rewrite the saved environment or replace Caddy, firewall rules, or application containers.

## Workflow and ownership

Docker's unique `<container>-updater` name atomically admits one operation across web processes and terminal invocations. Its labels record the source container ID, operation ID, target version and admission time. Its bounded Docker log retains structured progress across Slipway restarts. A repeated request joins the admitted operation. Unmanaged containers occupying that name are preserved. An abandoned creation can be retried only after the original container is verified healthy and temporary preflight storage users are absent.

The engine verifies the published image's actual version and migration checksum, retains verified native snapshots of all four datastores, and runs copy-only migration preflight in an operation-labelled container without a published host port. The updater itself has no database mount. Only after preflight exits does it stop the old writer and start the exact target image. Success requires the target container ID, application version, normal startup readiness and matching migration checksum. A generic HTTP 200 or preflight receipt cannot admit traffic.

The previous container remains until target readiness passes. Failure restores and verifies the previous container. Rollback never copies old database files over committed release migrations. Uncertain ownership, missing containers or unverified rollback require operator review; they do not become a successful update or an automatic retry.

Supported environment, mounts including read-only mounts, published ports, networks/custom aliases, labels, restart policy, resource limits, user, working directory, log configuration and security options are reconstructed. Explicit command, entrypoint or health-check overrides, privileged/device settings, host namespaces and static network addressing stop the update for review before replacement.

## Observation and recovery

Authenticated instance admins use `GET /api/v1/system/update-status`; SSE is an additional live view. Both UI surfaces poll durable status even when SSE never connects. Requests and response bodies have deadlines. Healthy responses from an old server do not prove rollback. Closing the modal or navigating away does not stop the engine.

Operator entry points inside a compatible image:

```sh
node /app/bin/slipway-updater.cjs status --container slipway
node /app/bin/slipway-updater.cjs watch --container slipway
```

`start` accepts a reviewed `--image`, `--version` and optional `--runner-image`. `install.sh` checks the target package version and runner interface in a read-only, network-isolated probe with no Docker socket or installation mounts. Unsupported targets (including official releases before 0.0.122), missing runners and mismatched metadata stop before admission; no legacy or fresh-install fallback is attempted. It then bootstraps and watches the verified immutable image ID, without pulling the tag again. Use a matching version-pinned installer and target. An already-installed older web updater retains its old behavior until updated. This source change does not patch an existing running installation. The engine's `run` command is internal to an admitted operation.

Read `docker logs --tail 100 slipway-updater` for retained progress. Do not remove a running updater to retry. For an interrupted state, preserve the updater, previous container and `db/system-backups/<operation-id>` while reviewing ownership and health. Follow [SQLite recovery](sqlite-recovery.md) for actual integrity failures. Completed operations remain available until a subsequent safe admission replaces the updater container.

## Backup archival

Verified local snapshots and the private manifest/archive remain under `db/system-backups/<operation-id>`. A durable `remote-pending.json` marker queues optional remote archival through the existing private storage adapters. The `archive-update-backups` Quest job processes one bundle every five minutes and resumes after restart. Successful archival writes a private `remote.json` receipt and retains local copies. Unavailable remote storage retains the pending marker and backs off for one day. The scheduler and valid backup storage configuration are required; local snapshots alone do not protect against losing the host. No automatic retention/deletion policy is introduced.

## Verification

WAL snapshots hold a read view on the readonly source connection while copying. This prevents concurrent commits on other connections from repeatedly restarting the incremental backup ([SQLite backup API](https://www.sqlite.org/backup.html)). The view is released before integrity verification, hashing and compression. Rollback-journal sources retain the existing incremental behavior rather than holding a long reader lock against live writers. A WAL reader can delay WAL reclamation, so the existing disk floor and size checks remain necessary.

Snapshot workers have a five-minute external command deadline. The Docker client is killed at that deadline; because killing a client alone does not guarantee that its container exits, the updater separately inspects and removes only temporary containers labelled with its operation ID. Uncertain ownership or failed cleanup blocks retry. Partial backup files remain for review. Maintenance workers use an init process and disable the web healthcheck. The original Slipway container is not stopped until verified snapshots and migration preflight have completed.

Retained progress identifies the current database and copy, integrity, hash or archive stage. Counts describe pages copied or input bytes read, not an overall success percentage. Completion still requires the verified four-database manifest. Deterministic native tests force commits between copy steps against the frozen 0.0.122 implementation and the fixed implementation: the baseline repeatedly restarts, while the pinned view completes with a consistent copied revision. This reproduces a failure mechanism, not a trace of the precise stage of a past production incident.

An image-only rebuild of an existing version verifies and builds the triggering workflow commit, rather than checking out a moving main after verification. The annotated release tag is preserved. Release notes must identify the corrected image's source commit and registry digest, since the original tagged source archive remains unchanged.

The opt-in `SLIPWAY_UPDATER_DOCKER=1 node --test tests/contracts/shared-updater.cjs` contract builds disposable images and runs the actual host installer with isolated volumes/network. Its minimal readiness fixture exercises the real startup writer guard, native migration catalogs, snapshots and receipts without lifting the full Sails app or scheduling application jobs. It proves successful replacement, failed-candidate rollback, preserved configuration, cleanup and an untouched witness container. Browser trials run the real settings page and reachable modal with controlled transport failures; deterministic engine trials cover admission races, checksum/preflight failures and interrupted ownership.
