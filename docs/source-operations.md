# Asynchronous source operations

The CLI sends source protocol 2, receives HTTP 202 and an operation ID, then
polls `/api/v1/source-operations/:id`. Deployment starts only after publication
completes and uses the returned source revision. Team members can inspect the
operation; DELETE requests cancellation. Cancellation is best effort before
publication: a completed publication remains completed.

The durable queue allows 20 outstanding uploads globally, two per project, and
two active workers. The project source lock also covers content edits and build
snapshots. Full queues return 503. Older CLIs wait on the same asynchronous
operation and retain their previous response format.

The web server coordinates uploads. On restart, queued work resumes and running
work becomes failed with recovery guidance. An interrupted directory publication
may require the lock/workspace inspection documented in source-publication.md.
Completed/failed records are retained for seven days and pruned on admission.

Git webhooks return deployment IDs promptly. Git runs in the existing cancellable,
durable deployment pipeline, using its concurrency and cleanup coordination controls. Legacy
repositories without a configured deploy key require HTTPS; private SSH
repositories should use the Git integration. Process calls use argument arrays,
which avoid shell parsing but do not replace validation or resource limits.
