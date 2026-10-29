# Unused build-cache retention

The `retain-build-cache` instance job uses the existing Quest scheduler hourly at minute 17 UTC,
without overlapping itself. Its friendly name is **Clean up old build cache**.
It is separate from deployment-image retention: cache accumulation and image
rollback protection are different storage concerns. No second scheduler or
Docker daemon configuration change is introduced.

The proposed defaults are enabled removal, at least 168 hours unused, a 20 GiB
retained-cache target, and a five-minute run budget. Policy validation prohibits
reducing the age below seven days or the storage target below 10 GiB. The storage
target is Docker's cache-pruning retention control, not a promised disk cap or
hard limit on bytes deleted. The job is host-wide for the default Docker builder.

`SLIPWAY_BUILD_CACHE_RETENTION_REMOVE=false` opts out to preview-only operation.
The installer persists and forwards this independent setting. Existing self-update
logic preserves it. A custom container must be recreated to change startup env;
the database Environment editor does not change this startup policy. The backend
accepts only the validated boolean `preview` diagnostic; UI uses configured defaults.

Before pruning, acquire the same exclusive image-operation guard used by image
retention. Deployment admission/workers and resource deletion hold shared image-use
admission, so this excludes Slipway builds and deployment/rollback transitions.
Read a complete Docker cache summary and check durable nonterminal deployment jobs;
any active cache or deployment work holds the run. Recheck before mutation.
Unsupported bounded prune flags, changed policy, missing disk metrics or incomplete
inventory also stop cleanup. External Docker builders must cooperate with the same
maintenance exclusion; Docker's unused-cache protection remains in effect.

The only removal command is `docker builder prune --all --filter until=168h --reserved-space 21474836480 --force` when the installed builder advertises `--reserved-space`, or the equivalent `--keep-storage` option on older builders. Buildx binds the deprecated `--keep-storage` and current `--reserved-space` flags to the same retention setting; it hides the deprecated flag from help. The seven-day and 20 GiB policy is unchanged. Do not substitute `--max-used-space` or `--min-free-space`, which have different semantics. Both review and execution inspect help only and hold if required options are absent or unverifiable.

See the [Buildx prune options](https://docs.docker.com/reference/cli/docker/buildx/prune/) and [the flag binding in Buildx](https://github.com/docker/buildx/blob/0dbe87f36ed472fe36b6796c3f70b4210a731fc5/commands/prune.go#L175-L182).

`--force` suppresses confirmation for this cache command;
it does not force deletion of images. No image, container, volume or system-prune
command is run. Builds may become slower when they need discarded cache again.

Persist a plan and audit entry before pruning. A timed-out/failed prune has an
unconfirmed daemon outcome: keep the exclusive guard, record an explicit hold,
and require operator inspection. Versioned dead use-owner recovery follows the
[shared image guard protocol](instance-quest-image-retention.md#interrupted-operation-holds);
legacy and uncertain cleanup records are not automatically retired. Never release or expire that guard merely because
the caller stopped or its PID is absent. If the command completed but after-metrics
failed, report failed measurement rather than inventing reclaimed space.

Record before/after raw filesystem availability and Docker cache accounting
separately. `filesystemAvailableDeltaBytes` is a measured net change that can be
negative under concurrent workloads. `dockerReportedReclaimed` is Docker's reported
cache-accounting total, not measured physical bytes freed. Shared layers make
summing image sizes, cache sizes or per-record totals misleading. Preview/held runs
leave the measured delta null and explain the hold instead of reporting fake zero
reclamation. Job output and audit records remain bounded.

This implementation is local and pending review and publication; it does
not describe a cache job already installed in v0.0.105.

## Manual cleanup from Infrastructure (#881)

Instance administrators can choose **Prune** on Infrastructure's Host disk card.
The review reads Docker's cache summary and the configured policy without running
cleanup. Docker's reclaimable figure includes unused cache outside the age and
retained-storage policy, so it is an estimate rather than promised disk savings.
The default removal remains unused cache at least seven days old with a 20 GiB
retained-cache target; the UI cannot pass Docker flags or override that policy.

Confirming requests the existing `retain-build-cache` Quest job with a durable
request identity. Repeated requests reuse the same admission. Server-side instance
authority and CSRF protect execution. A user-attributed audit record links the
request to its retained Quest run; the result includes the cleanup audit run ID.
The shared exclusive image-operation guard and the existing rechecks exclude
Slipway builds, deployment transitions, updater operations and other cleanup.
An active operation holds cleanup rather than bypassing it. Uncoordinated external
Docker activity is still subject to Docker's unused-cache rules.

The card reconnects to retained progress after reload and refreshes host disk
measurements after completion. Results distinguish Docker-reported reclaimed cache
from the measured net filesystem availability change, which can be negative.
Unavailable after-measurements and uncertain command completion remain explicit
failures; an uncertain cleanup retains its maintenance guard for inspection.
No image, container, volume or system prune is performed. Disabled removal,
unavailable inventory or measurements, and active builds/deployments prevent
confirmation. Backend admission and mutation-time checks remain authoritative if
state changes after review.

The operational status toast uses the same Klean toast host as deployment progress.
It follows backend-persisted checks, pruning and measurement refresh, then reports
confirmed completion, a safety hold, failure or an unconfirmed outcome. There is
no invented percentage and held work is not silently queued for retry. Manual
request identity binds stage updates to the admitted run; scheduled or unrelated
records cannot claim its progress. Tracking survives navigation and reload in the
same tab and the toast links back to the detailed review. A failed progress
connection explicitly says that work may still be running. Dismissing the toast
does not cancel or restart the job.

Updater exclusion includes custom-named installations on the host. Cleanup takes
the shared exclusive cache guard before reading updater admissions; the detached
updater owns its unique admission container name before checking that guard on a
read-only mount. If they overlap, at least one side holds before mutation. An
uncertain updater owner prevents cleanup rather than being treated as idle.
