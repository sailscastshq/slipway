# Read-only deployment image inventory

This procedure is an inspection plan, not deletion authorization. Run on the
existing SSH host only after read-only access is authorized. Do not lift Sails,
invoke a Quest job, run the retention `run` helper, remove guard files, restart,
install, or run Docker prune. Preview jobs also write locks/audits/history.

## Docker references

These commands only query Docker. They deliberately avoid container environment
variables, labels, mounts, logs and full inspect output, which can contain secrets.
Use the existing SSH alias/identity; no host credentials belong in the report.

```sh
ssh "$SLIPWAY_SSH_HOST" 'docker system df'
ssh "$SLIPWAY_SSH_HOST" 'docker image ls --no-trunc --digests --format "{{json .}}"'
ssh "$SLIPWAY_SSH_HOST" 'docker ps -a --no-trunc --format "{{.ID}} {{.Image}} {{.Status}}"'
```

For every returned container ID, including stopped containers, inspect only its
immutable image ID. Validate the full hexadecimal container ID before insertion:

```sh
ssh "$SLIPWAY_SSH_HOST" 'docker container inspect --format "{{.Id}} {{.Image}} {{.State.Status}}" FULL_CONTAINER_ID'
```

For each full `sha256:` image ID, query only immutable identity, aliases, created
time and virtual size:

```sh
ssh "$SLIPWAY_SSH_HOST" 'docker image inspect --format "{{json .Id}} {{json .RepoTags}} {{json .RepoDigests}} {{json .Created}} {{json .Size}}" sha256:FULL_IMAGE_ID'
```

Never infer the rollback from Docker tags or creation dates alone. Preserve all
container references and all control-plane images, including the current and
previous Slipway release. Shared layers mean virtual sizes are not freed bytes.

## Durable references and offline assessment

An authorized operator must first confirm the actual configured datastore path
(the repository default is `db/app.db`) and acquire a consistent **read-only**
snapshot of these selected columns. Use SQLite read-only/query-only access and a
single read transaction; do not copy only `app.db` while WAL writes are active.
If tooling/permissions cannot produce a complete snapshot, stop and report held.
Do not dump entire tables or arbitrary settings.

| Model            | Selected columns / filter                                                       |
| ---------------- | ------------------------------------------------------------------------------- |
| Deployment       | id, app, environment, status, imageName, imageId, createdAt                     |
| App              | id, environment, imageName, imageId, currentDeployment                          |
| DeploymentJob    | id, deployment, targetDeploymentId, imageName, stage                            |
| Service          | id, type, status, managementMode, imageReference, imageMetadata, customRecovery |
| CleanupOperation | id, snapshot where retentionPolicy = retain                                     |
| Setting          | key, value where key starts with deploymentRecovery                             |

Also obtain only the effective image-retention settings and pins; never dump the
environment or unrelated settings. Recovery JSON must be parsed and restricted to
image/deployment references before sharing; retained snapshots can contain private
data. Keep raw snapshots local and private. Record any unresolved/missing records.

Assess the complete bounded snapshot locally with the corrected planner, using
model adapters that return these arrays, not a Sails lift or production job. The
planner itself only reads model rows and returns a plan. Report full immutable IDs
with one of: live/container, one rollback, active work, pin/recovery, ambiguous or
out-of-scope, eligible. Explicit null recovery previous means no guessed rollback.
Fail closed on conflicting IDs, unresolved protections, missing tables, truncated
inventory or uncertain associations. Record capture times; Docker and database
reads are observational and cannot guarantee a cross-system atomic snapshot.

Provide that plan for separate cleanup approval. A later authorized deletion must
use the normal shared guard, complete fresh inventory and per-ID checks; this
read-only report is never a list to pipe into `docker image rm`. Do not use force
or blanket prune. No production commands have been executed by creating this file.
