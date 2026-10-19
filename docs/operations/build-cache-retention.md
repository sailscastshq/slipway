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

The only removal command is `docker builder prune --all --filter until=168h --keep-storage 21474836480 --force`. `--force` suppresses confirmation for this cache command;
it does not force deletion of images. No image, container, volume or system-prune
command is run. Builds may become slower when they need discarded cache again.

Persist a plan and audit entry before pruning. A timed-out/failed prune has an
unconfirmed daemon outcome: keep the exclusive guard, record an explicit hold,
and require operator inspection. Never release or expire that guard merely because
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
