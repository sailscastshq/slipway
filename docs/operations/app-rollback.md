# Previous healthy app release

App rollback uses one explicit previous healthy image for the same app and
environment. It does not offer arbitrary historical rows whose binary may have
been deleted. The deployment page and rollback API share one eligibility resolver.
A stopped successful predecessor is accepted when it is the recorded target, its
full immutable local image exists, and compatibility and current-generation checks
pass. Failed/cancelled deployments and another app's history are never targets.

## Compatibility contract

Declare a backward-compatible application/data/configuration window in both images:

```dockerfile
LABEL io.slipway.rollback.compatibility="schema-1"
```

Choose a new value when the previous image cannot safely use the current database,
data or current runtime configuration. This is an explicit application-owner
assertion, not automatic proof from an HTTP health response. Test upgrade and
downgrade behavior against representative migrated data before declaring a window.
Missing, changed or invalid declarations block rollback. The UI explains that
application-image rollback does not reverse database schema, data, uploads, queues,
service changes or external side effects. It uses current configuration and secrets;
it does not restore old or revoked credentials. Database restore requires a separate
explicit recovery procedure. No down migration or backup restoration runs here.

## Promotion and recovery

After readiness succeeds, the existing fenced transactional route cutover writes
App traffic ownership and a versioned recovery record in the existing settings
table together. Full image IDs and declared compatibility are recorded; mutable
image tags are never rollback execution targets. The candidate runs by immutable
ID with `--pull never`, then passes existing container/HTTP health checks before
traffic changes. A missing image never triggers a hidden pull, rebuild or tag fallback.

A normal successful promotion preserves the previous distinct healthy current image.
A failed candidate never advances these references. Repeated deployments of the
same image do not consume another recovery slot. Rollback creates a new deployment
record for the retained artifact; its durable intent records the expected current
deployment, target app/environment, image ID and compatibility window. Admission
and worker execution both validate intent. A changed current generation causes an
explicit failure before network/container operations.

After successful rollback, the displaced image is marked rejected as an automatic
recovery target. It is not immediately offered as another rollback. A subsequent
healthy redeploy can retain the newly current healthy image as its predecessor.
Only one previous artifact is promised; older history remains metadata.

A failed cutover restores App and recovery metadata together. If route/App
restoration cannot be verified, preserve both containers/artifacts and record a
durable operator hold. Further deployment/rollback admission and image cleanup stop
until an operator verifies actual traffic ownership, containers and recovery state.
Do not clear a hold simply because it is old. Clearing a hold is not a repair of
routing or data. Fenced current-generation checks prevent an old worker from
silently overwriting another deployment's App/recovery state.

## Cleanup and upgrade behavior

Cleanup stays enabled and retains the existing minimum age of 14 days and recent
three-successful-image floor. These are floors, not a strict disk/image cap.
Explicit current/previous recovery IDs survive regardless of age, alongside all
container, active/in-flight job, rollback, pin, service and recovery references.
Corrupt, missing or mismatched protection references hold cleanup. Unknown,
untagged legacy and multi-tag images are not newly made eligible by this feature.
Expected non-force Docker conflicts defer the affected candidate and allow
independent cleanup candidates to proceed.

No database schema migration is required. Recovery and intent records use private
namespaced rows in the existing settings table; keep the persistent writable `db`
volume. This implementation does not guess immutable identity or successful
promotion metadata for legacy tag-only history. Such history reports no verified
recovery target until successful deployments establish current/previous records.
No records, pins, images or containers are deleted merely by installing this feature.
The API now requires `expectedCurrent` with the chosen `deploymentId` and app slug;
clients must refresh after a stale-target rejection.

UI and lifecycle evidence use synthetic local fixtures. No production rollback,
cleanup, installation or database/data operation is part of those tests.
