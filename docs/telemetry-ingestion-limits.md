# Telemetry ingestion limits

Application telemetry expires according to its server-generated `createdAt`
receipt timestamp, regardless of the app's clock. Event timestamps more than
five minutes ahead or seven days behind receipt time are replaced with receipt
time; the ingestion response reports `clockAdjusted`.

Each batch is limited to 500 spans, 200 exceptions, and 1,000 metrics, with 32 KiB
per event and 512 KiB per batch. Invalid arrays, null items, non-finite numeric
fields, and oversized events return 400 before storing any event in that batch.

By default each environment may submit 3,000 events, 2 MiB, and 120 requests per
minute. Atomic database updates enforce these limits across concurrent requests
and server restarts. A rejected request returns 429 with `Retry-After`; retrying
must not be an unbounded immediate loop. Limits can be adjusted through
`custom.observability.ingestionEventsPerMinute`, `ingestionBytesPerMinute`, and
`ingestionRequestsPerMinute` in server configuration.

Lookout displays cumulative rejected-event and rejected-request counters for the
environment. Its environment metrics API exposes the current budget and counters
as `ingestion`. Deleting an environment removes its budget record.
