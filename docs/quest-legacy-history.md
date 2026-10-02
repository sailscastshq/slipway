# Quest legacy history

Quest currently displays telemetry events rather than a durable, correlated run
ledger. The dashboard reads at most the latest 500 `quest.job.*` events in the
last seven days, scoped to the environment (not an individual app). This cap
includes starts and other non-terminal events. Application telemetry retention
is seven days by default and is configurable; shorter retention, event delivery
gaps, or the event cap can shorten the visible window. See
[observability retention](./observability-retention.md).

Scheduled `complete` / `error` and manual `completed` / `failed` names normalize
to `completed` / `failed` once per stored event. Start events are not counted as
terminal events or matched heuristically to a later completion. The 24-hour
cards count the terminal events present in this bounded window, not all runs.
With no terminal events, the completion rate is unavailable rather than 100%.
There are no stable run IDs, reliable deduplication of delivered legacy events,
or cross-source correlations. Do not infer unique execution counts from these
events. Expanded history shows at most 20 terminal events per script; its local
selection uses the stored telemetry row's `eventId` and survives refreshed or
prepended snapshots while that event remains visible. This is an event identity,
not a run identity or stable run link. It does not correlate separate records.

Manual output preserves stdout and stderr separately, including warnings when
the Docker client exits zero. A completed receipt describes process execution,
not whether business work completed, was skipped, or needs reconciliation. Logs
are not parsed as a business result. The dashboard refreshes persisted telemetry
after a receipt instead of injecting an optimistic history row: this avoids
counting the same receipt both locally and from a concurrent snapshot. A failed
telemetry write can leave immediate output without a retained history event.

HTTP rejection, failed transport, invalid response JSON, and absent or
contradictory exit evidence do not become completed/failed history entries in
the browser. A Docker client spawn error or signal without an exit code returns
`exitCode: null` and records no terminal event. The outcome remains unconfirmed;
the in-container job may still be running. Check available evidence before a
new deliberate invocation. No automatic retry is performed.

## Limits and remaining work

This correctness slice of [#653](https://github.com/sailscastshq/slipway/issues/653)
does not complete that issue. Manual receipts still describe the legacy Docker
client invocation; a nonzero client exit cannot distinguish all infrastructure
errors from script failures. The five-minute client timeout does not prove the
in-container process stopped. Output is still buffered; this change does not
add streaming, output bounds, redaction guarantees, cancellation, or structured
script return values. Existing scheduled failure diagnostics remain intact.

Further phases need:

1. An authenticated, versioned resident runtime contract and disposable fixture
   proof of scheduler ownership, effective metadata, pause/overlap behavior, and
   safe local-runner invocation. Existing temporary inspection/control paths are
   not proof of resident state; preserve safe migrations and Helm scheduler
   suppression, and do not advertise new control guarantees from this slice.
2. Typed input metadata and validation plus explicit invocation authorization,
   without changing customer dependencies silently.
3. Stable run identity, persisted correlated terminal evidence and separately
   captured business return values, with idempotent ingestion and bounded,
   sanitized payloads. Upstream Quest runner support must precede those claims.
4. Reconnect/replay, runtime-loss reconciliation and cancellation, enabled only
   after resident process ownership and termination tests pass.

Tests for this slice use synthetic responses, a disposable fake client, and
in-memory datastores. They do not prove Docker/resident scheduler behavior or
execute customer jobs. Browser regressions must also pass in supported CI;
request/helper tests alone do not establish visual or navigation behavior.
