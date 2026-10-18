# Instance Quest and deployment image retention

Bosun → Quest shows Slipway's registered maintenance jobs, their existing UTC
schedules, the runtime's next-run time, running state and the latest 100 runs.
Opening Bosun never invokes a job. Instance administrators can review and run an
allowlisted job with its configured defaults. Arbitrary scripts and custom input
values are rejected. Manual requests have durable identities, so retrying a
retained request does not execute it again. Scheduled execution remains owned by
the existing Quest hook, including its overlap prevention and console children.

History is stored as bounded, redacted JSON records under `db/instance-quest/`
(mode 0600). There is no database schema migration or synthetic App/Environment.
Keep the existing writable, persistent `db` volume. After a restart, unfinished
runs are marked interrupted with unknown completion; inspect effects before
running them again. History starts when this feature is installed. If history is unreadable or corrupt,
Bosun reports it and disables instance manual runs while the rest of Slipway starts;
preserve and inspect the records before repairing storage. Linux Quest
owned children supply live output; other platforms show output at completion.
The UI polls while visible and retains each stream's last 32 KiB. Return values
are bounded to 16 KiB and may be unavailable when larger.

## How the daily cleanup works

`retain-deployment-images` runs every 24 hours. By default it only produces and
audits a preview. Bosun's Run button uses server configuration and cannot turn
removal on. `SLIPWAY_IMAGE_RETENTION_REMOVE` remains unset/false for this rollout;
a separate reviewed rollout would be needed before changing it.

1. Acquire the cleanup lock and exclusive shared image-operation admission.
   Deployment enqueueing, reconciliation and deploy/rollback workers hold shared
   image-use admission, so they can run concurrently with each other but cannot
   race cleanup. Busy cleanup is reported as held.
2. Inventory all Docker images and all containers, including stopped containers,
   and bounded deployment, job, app, service and retained-cleanup references.
   Resolve complete immutable IDs. Incomplete, ambiguous or unresolved protection
   references hold the run; no candidate is removed.
3. Protect every container reference, active deployment/job and rollback target,
   configured pin, current app and the latest three distinct successful images
   per app/environment, plus service and recovery references. Only images whose
   tags all match known Slipway deployment records can qualify. This also leaves
   control-plane release images (current and previous), Coolify, unknown aliases
   and untagged legacy images untouched.
4. Select images strictly older than 14 days. Persist the plan to
   `imageRetentionLastRun` and write its audit record before any removal.
5. If a future rollout explicitly enables removal, process at most 10 images per
   run. Re-read policy, complete inventory and all references for each exact image
   ID while retaining the exclusive guard. Use `docker image rm --no-prune ID`,
   never force, blanket prune, volume pruning or build-cache pruning. Stop on
   failure or a changed/held inventory; record removed, skipped and failed IDs.

Volumes, backups, build cache and unrelated images are outside the operation.
Virtual image sizes share layers; a candidate-size sum is not reclaimed disk space.
Review actual host usage after a future removal rollout.

## Interrupted-operation holds

Guard files are under `db/image-operation-guard/`; cleanup also uses
`db/image-retention.lock`. They deliberately have no automatic stale timeout.
A crashed or interrupted owner leaves a conservative hold rather than allowing a
slow deployment or rollback to race deletion. An operator must verify that no
web/console worker or deployment owns the marker before removing a stale hold.
Do not delete holds merely because a timestamp looks old. These internal files
are not committed and must remain on the same instance db volume across console
children. This feature assumes Slipway's existing single web scheduler instance.

The explicit local installer destroy command can recover ownership of private
container-created state before deleting its local fixture directory. Its recovery
container has one bounded mount, no network and no Docker socket; production
history permissions remain private.

## Local evidence

The unit tests replace Docker execution and use disposable directories. The
browser test replaces the instance adapter with synthetic job metadata and output;
its manual button invokes only the fixture. Screenshots under
`output/bosun-quest/` are fixture captures, not production observations. Relevant
Sounding tests cover existing deployment cutover/queue behavior, instance-admin
permissions, CSRF and mobile/desktop controls.
