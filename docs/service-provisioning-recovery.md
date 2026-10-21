# Interrupted managed service provisioning

Issue: https://github.com/sailscastshq/slipway/issues/836

A process can stop after creating a service record but before image resolution, Docker startup, or connection-variable finalization. The old UI leaves that record at Creating; neither Start nor Delete resumes creation. The recovery action retains the service ID, credentials, container name and durable volume. It never deletes a container or volume.

## Admission and completion

The Services action menu exposes **Retry provisioning** only for eligible managed PostgreSQL, MySQL, MongoDB or Redis records in Creating/Failed. The endpoint rechecks eligibility and team ownership. A short database transaction exclusively claims the record with an operation token in its existing `imageMetadata` JSON; no schema migration or new credentials are needed. Concurrent claims compare the prior operation and record revision. Cleanup admission shares the transaction boundary and pending project/environment/service cleanup excludes provisioning. Legacy image discovery also rechecks the service under this transaction discipline so a console worker cannot overwrite a newly claimed owner while inspecting Docker.

A running owner is never expired by an arbitrary timeout. Linux boot/PID-namespace/start-tick identity distinguishes a live owner, a dead PID and PID reuse. A different namespace requires inspection proving the recorded Docker runtime generation ended. Unknown ownership or Docker errors fail closed. For legacy records without owner metadata, recovery requires a verified current `slipway` container matching the executing process, whose Docker start time is after record creation, with no live `slipway-previous` coordinator. This targets the existing single-coordinator installation; nonstandard or ambiguous topologies require operator inspection. A failed attempt recorded by the new code can be retried; a completed provision is not repurposed to recover unrelated failures.

Before retrying, the implementation inspects the exact named container and expected volume. A matching container must retain the immutable image, named-volume mount, Slipway network, PostgreSQL data path and configured credentials. It is adopted if running, or started if stopped/created. Mismatches, uncertain inspection and unproven existing volumes stop recovery. Missing artifacts continue the existing provisioning path, which reuses stored credentials and persists its pinned image before Docker startup. Readiness and authenticated, read-only database probes are checked before completion. PostgreSQL/MySQL use TCP SELECT 1; Redis uses authenticated PING; MongoDB authenticates before pinging. Authentication is retried at most ten times with a one-second interval to tolerate the official images’ temporary initialization servers. Probe errors never return command arguments or credentials.

Managed connection values, metadata, value-free audit events and the final Running/completed state commit in one transaction. Existing conflicting variables are preserved and cause a failed attempt; no credentials are returned by the retry endpoint or included in its errors. A crash before this transaction can retry by adopting the original container; a crash during it cannot publish partial completion. The owner token and identity are excluded from public service records. The action runs on explicit request, not an automatic schedule.

## Operational boundaries

This PR does not retry production service 19, merge/release Slipway, change limits, restart unrelated services, or diagnose a native fault conclusively. Before a separately approved retry, verify current host/container health and disk/memory headroom, confirm the old provisioner stopped, and inspect exact artifact names. Preserve any unexpected artifacts rather than changing status with SQL or deleting/recreating the service.

Middlefour's anonymous landing page does not require this database or Redis. Its already merged landing-only scope and original theme are unchanged.

## Crash-evidence provenance (21 October 2026)

The existing authenticated CLI connection was used only for bounded read requests. The source for the reported counts was `GET /api/v1/bosun/logs/stream?tail=6000`, which invokes Docker logs for the fixed `slipway` container, with timestamps. The reader received 6,001 SSE data events including the connection event, then stopped at an idle timeout. It counted each matching log event once per marker category:

- 19 log events matched `SIGBUS` or `bus error`; the returned signal-token extraction found no literal uppercase SIGBUS token. Matching-event timestamps ranged from 15:19:21.633688765 through 16:57:07.188677909 UTC.
- 9 events matched SQLite busy/locked text, between 15:30:48.748202210 and 16:48:58.883730897 UTC.

These are **log-entry matches, not distinct crashes**. No incident-level deduplication, PID/container-exit correlation or crash grouping was performed. Multiple entries could describe the same failure or child command. The first/last timestamps above bound matched entries, not the full retained log window. Raw logs and command lines were not retained/copied because they can contain credentials; the original summary cannot now establish unique crash counts.

The source container is Slipway, but the affected process is unknown: its stdout/stderr also carries child/console command output. These entries do not prove that Slipway's resident Node process, its container or a Bridge worker died. A health read immediately before the snapshot reported 0.0.114; historical lines may predate that version, so the entire window cannot be attributed to 0.0.114. The October 16 exit-135 incident in `docs/incidents/807-sigbus.md` is separate evidence and must not be relabelled as this incident.

Current host-disk API evidence was 36% used. A subsequent Sailsconf metrics read returned 79 samples over 40 minutes, ending 17:13:38 UTC, with a recorded memory maximum of 59.47% of its 1 GiB limit and CPU maximum 105.61% (roughly one core). Samples around the 16:41:33 database interruption alternated CPU-heavy/higher-PID and quieter/lower-PID states, consistent with transient work but not proof of a crash cause. The later process snapshot reported no Bridge worker. Sampling can miss peaks and excludes other host processes; none of this rules out container/host OOM or a native fault.

Needed next: exact container exit/OOM/restart state and actual limits, host memory/swap/kernel evidence and safely reviewed native crash metadata. Bridge usage concurrent with other Slipway work is a user-reported correlation, not a proven mechanism. The Hetzner PHP advisory is not evidence of a Node/Bridge network outage. No production stress tests, dumps, debugger changes or restarts were used.

## Validation

Focused tests cover PID reuse/unknown owners, runtime generations, artifact identity, immutable-image/volume retention, simultaneous claims, active-owner exclusion, cross-team access, conflicting variables, transactional rollback during audit finalization, crash-style container adoption, private operation metadata and truthful UI failure feedback. Existing service lifecycle and cleanup regressions are included. The UI trial uses an isolated local headless browser and disposable test datastores.
