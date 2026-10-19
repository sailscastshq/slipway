# Previous healthy app release

App rollback uses one explicit previous healthy image for the same app and
environment. It does not offer arbitrary historical rows whose binary may have
been deleted. The deployment page and rollback API share one eligibility resolver.
A stopped successful predecessor is accepted when it is the recorded target, its
full immutable local image exists, and compatibility and current-generation checks
pass. Failed/cancelled deployments and another app's history are never targets.

## Compatibility review

No Dockerfile or environment change is required for normal rollback. An unlabelled
image has **unknown** schema compatibility; unchanged models or a passing HTTP health
check do not establish compatibility. The existing review dialog requires a concise
explicit acknowledgement that the previous app can use the current schema and
configuration. The API requires `acknowledgeUnknownCompatibility: true` for that
case, and the durable intent carries the acknowledgement through worker execution.

Applications may optionally declare a compatible window:

```dockerfile
LABEL io.slipway.rollback.compatibility="schema-1"
```

Matching declarations are application-owner evidence, not an automatic proof. Two
conflicting declarations block rollback even if acknowledgement is supplied. One
missing declaration remains unknown and requires acknowledgement. No declaration is
inferred from unchanged source, models, or schema. Invalid declarations fail closed.

Rollback does not reverse database migrations, data, uploads, queues, service changes
or external side effects. It uses current configuration and secrets; it does not
restore old or revoked credentials. Database restore is a separate explicitly
approved recovery procedure. No down migration or backup restoration runs here.

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
volume. Existing apps can acquire recovery metadata immediately when successful app/environment
provenance and immutable local identity are provable. A recorded full image ID is
accepted after local inspection. Otherwise, a bounded completed Docker export receipt
must contain a full image ID and name the exact generated deployment-specific tag in
the same export step. A tag alone, arbitrary hash in logs, incomplete/ambiguous receipt,
wrong app/environment, unfinished history, missing image or unsupported legacy rollback
history does not qualify. The inspector verifies exact identity and Docker-host platform
without pulling or rebuilding.

Page eligibility is read-only. Rollback admission rechecks provenance and receipts,
then atomically binds current/previous image IDs and recovery metadata with the queued
intent under shared image-use admission. Normal promotion also preserves a provable
legacy current image as its predecessor. Existing labelled builds and two rebuilds are
not prerequisites. Where proof is absent, the UI explains why recovery is unavailable;
it never guesses from the current contents of a mutable tag.

No records, pins, images or containers are deleted merely by installing this feature.
The API now requires `expectedCurrent` with the chosen `deploymentId` and app slug;
clients must refresh after a stale-target rejection. Unknown compatibility additionally requires the explicit acknowledgement field described above.

UI and lifecycle evidence use synthetic local fixtures. No production rollback,
cleanup, installation or database/data operation is part of those tests.
