# Restoring a backup

Pause application and external database writes before restoring. Slipway does
not infer which outside clients hold database credentials. The API requires
`writesPaused: true`; the CLI requires `--writes-paused`; the service page has
an explicit acknowledgement. Keep writes paused until the result is verified.

Each attempt has a durable operation ID and queued/running/completed/failed
state, visible at `/api/v1/restore-operations/:id` and on the service page.
The queue allows 20 operations and two workers. An atomic service transition
excludes a simultaneous restore or version upgrade. New Dock connections and
backups cannot select a restoring service; restart/stop/delete controls refuse
active restores. Project and environment cleanup also pause before removing
traffic or containers while a restore is active; pending cleanup blocks new
restores. Existing external database sessions must be paused by the
operator before admission.

The worker first creates and verifies a safety snapshot, records its ID, then
reports download and import stages. Snapshot/download failures leave the
original database intact. Import failure can leave partial data, so the service
is marked failed and the operation points to its safety snapshot. Inspect and
restart the service as necessary, then deliberately restore that snapshot.

On server restart, queued work resumes. A running restore becomes interrupted;
it is never automatically replayed. Keep writes paused and inspect the database
before recovery. Audit events are restore.started, restore.completed,
restore.failed, or restore.interrupted; queuing is not reported as completion.
