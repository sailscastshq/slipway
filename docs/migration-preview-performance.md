# Migration preview performance

Dock's migration preview first loads the deployed app's normalized model schema,
then inventories the database, compares physical contracts and, where required,
runs a native preflight before creating a reviewed server-owned plan. Each phase
must be measured separately before attributing a slow page to the editor or the
diff algorithm.

## Bounded native catalog batches

The native catalog inventory uses the existing labeled multi-statement SQL
transport in groups of at most 20 queries. PostgreSQL needs three client calls
(columns, indexes, then constraints/triggers/views), down from five. MySQL needs
`2 + ceil((2 + tableCount) / 20)` calls, down from `4 + tableCount`.

The same complete native definitions are retained. Every batch must have the
expected number of successful, correctly ordered result sets, each containing a
row array. Missing definitions and partial/failed batches fail closed. Batches
remain sequential so the migration transaction's single PostgreSQL session is
never used concurrently. The SQL transport's existing output and timeout bounds
still apply; an oversized catalog is rejected rather than partially verified.

This changes neither model inspection isolation nor preflight, plan expiration,
freshness checks, migration execution, or database locking. It adds no schema or
migration-plan cache.

## Reproduce the controlled transport benchmark

From the repository root, with dependencies installed:

```sh
# Before: the last main revision before this change.
git show 88c53d23fe2149cede8eea30a0051badc3d13aec:api/helpers/dock/get-schema.js > /tmp/slipway-schema-before.cjs
NODE_PATH="$PWD/node_modules" CATALOG_HELPER=/tmp/slipway-schema-before.cjs node scripts/benchmark-migration-catalog.js

# After: current helper, identical fixture and injected transport latency.
node scripts/benchmark-migration-catalog.js

# No injected transport latency: isolate local JavaScript work.
CATALOG_LATENCY_MS=0 node scripts/benchmark-migration-catalog.js
```

`CATALOG_TABLES`, `CATALOG_SAMPLES` and `CATALOG_LATENCY_MS` configure the fixture.
The benchmark runs the actual schema helper and SQL splitter against a
deterministic transport: 40 tables with 20 columns, one index and trigger per
table, PostgreSQL constraints and a view. It warms once and reports 15 samples.
It never connects to an existing database or runs a migration.

Measured on Node 24.19.0 in the development container on October 2, 2026, with
**10 ms artificially injected per client call**:

| Engine           | Before calls | After calls |   Before p50 / p95 |  After p50 / p95 |
| ---------------- | -----------: | ----------: | -----------------: | ---------------: |
| PostgreSQL       |            5 |           3 |   51.39 / 52.48 ms | 31.08 / 32.64 ms |
| MySQL, 40 tables |           44 |           5 | 449.88 / 454.52 ms | 51.23 / 51.74 ms |

The SHA-256 of the full serialized schema was identical before and after for
each engine. These timings quantify transport amplification; they are **not
production page-load or real database timings**. Browser rendering, live Docker
startup, model loading, network throughput and migration preflight are not in
this fixture. Unit tests exercise batch boundaries, preservation, failures and
the single-session transaction path. CI's existing disposable PostgreSQL/MySQL
schema contract jobs exercise the actual SQL transports and migration safety.

## Remaining page-level profiling

For representative authorized development apps, record cold and repeat timings
for model inspection, catalog reads, diff/SQL generation, preflight and HTTP
payload/rendering separately. Include larger table/view counts and multiple
concurrent viewers. Preserve full safety checks while finding redundant work.
The first catalog improvement does not establish the cause or size of a
reported production regression.

## Large runtime snapshot integrity

Deeper phase profiling also reproduced a runtime read failure before catalog
comparison: the isolated ORM script wrote its JSON to stdout and immediately
lowered/exited. Pipe writes are asynchronous. A 210,137-byte snapshot for 40
application models with 20 columns each (plus Sails' archive model) was sometimes
cut off at 146,176 bytes despite exit code zero. Dock then rejected the JSON and
tried the static source fallback, repeating model discovery and preventing a
runtime-authorized migration plan.

The script now awaits the stdout write callback before cleanup/exit and reads
`sailsApp.models` directly, so applications that disable the optional global
`sails` also work. The parent uses UTF-8 stream decoding across Buffer boundaries
to preserve non-ASCII identifiers and defaults. Isolation, safe auto-migration
suppression, timeouts and output limits stay in force.

Reproduce with a disposable local Sails/SQLite app (no Docker or existing data):

```sh
git show 88c53d23fe2149cede8eea30a0051badc3d13aec:api/helpers/dock/get-models.js > /tmp/slipway-models-before.cjs
MODEL_HELPER=/tmp/slipway-models-before.cjs node scripts/benchmark-migration-models.js
node scripts/benchmark-migration-models.js
MODEL_BENCH_GLOBALS=off node scripts/benchmark-migration-models.js
```

On Node 24.19.0, one warmup plus seven measured inspections produced five
truncated snapshots before the fix and seven complete snapshots after it. All
child processes exited zero, so exit status alone was insufficient. Truncation
is scheduling-dependent; the failure rate is not a production estimate. The
fixed isolated ORM phase measured p50 494.47 ms / p95 518.73 ms in that run,
excluding Docker, live target discovery, HTTP, native preflight and browser work.
This is an integrity correction, not a claimed cold-start latency speedup.

Regression tests use a real child stdout pipe with a greater-than-1-MiB model
payload, both with and without the global Sails object, plus deliberately split
multibyte stdout/stderr. They verify every model
and its final attribute after parsing the full JSON, alongside the existing
configuration and auto-migration-suppression assertions.
