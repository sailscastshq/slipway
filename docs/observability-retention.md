# Observability retention

Lookout stores container samples and application telemetry in
`db/observability.db`. Collection and maintenance are separate: Docker metric
collection runs every 30 seconds, while the `maintain-observability` Quest job
prunes expired rows and checks host disk health every 5 minutes. Maintenance
therefore continues when Docker is unavailable or no application containers
are running.

## Defaults

| Data                                               | Default retention | Configuration                                  |
| -------------------------------------------------- | ----------------: | ---------------------------------------------- |
| Container CPU, memory, and I/O samples             |          24 hours | `SLIPWAY_CONTAINER_METRICS_RETENTION_HOURS`    |
| Request spans, exceptions, and application metrics |            7 days | `SLIPWAY_APPLICATION_TELEMETRY_RETENTION_DAYS` |

Pruning deletes at most 500 rows per table and performs at most 20 batches per
table during one run. These bounds can be changed with
`SLIPWAY_OBSERVABILITY_PRUNE_BATCH_SIZE` and
`SLIPWAY_OBSERVABILITY_MAX_PRUNE_BATCHES`.

All values must be positive numbers. Invalid values fall back to the defaults.
The batch size is capped at 900 rows so each SQLite statement stays within its
parameter limit.

## Existing installations

On startup, Slipway creates the observability tables and indexes if necessary.
Container samples from the legacy `db/app.db` location are copied in bounded,
idempotent batches. Slipway verifies the copied row count before removing the
legacy rows, so an interrupted startup safely resumes the migration.

Lookout shows the last successful collector and retention run, retained row
count, and stale or failed state in the existing host-health card. The same
health object is returned by `GET /api/v1/lookout/overview`.
