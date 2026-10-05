# Quest history payload budget

## Reproduce

This explicit contract benchmark is outside the default unit, functional, and
browser lanes. It uses Sounding's disposable, real `sails-sqlite :memory:`
observability datastore and refuses a different datastore URL.

```sh
SLIPWAY_QUEST_HISTORY_REPORT=.tmp/quest-history-budget.json \
  npx sounding test --file tests/contracts/quest-history-budget.test.js \
  --test-concurrency=1
```

Source: `tests/contracts/quest-history-budget.test.js`.

## Fixture and comparison

Both readers query the same 500 uncorrelated synthetic Quest telemetry events:
375 completion events and 125 failure events, all for one job and environment.
Each event contains exactly 32,768 UTF-8 bytes of stdout and 32,768 bytes of
stderr, totaling 32,768,000 historical log bytes. There are no correlated runs.

- Existing reader: `sails.helpers.quest.getJobHistory`, returning 500 complete
  legacy events including their logs
- New reader: `ledger.listRuns`, returning 25 SQL-projected summaries with a
  continuation cursor

The byte comparison is uncompressed initial **history JSON**, specifically
`{ jobHistory: [...] }` for the existing reader and
`{ runs, legacyEvents, nextCursor }` for the new reader. It is not the complete
Inertia response, document HTML, or transferred assets.

Each reader receives one warmup read followed by seven measured reads. Their
order alternates. Timings include database reads and JavaScript mapping, but
exclude JSON serialization. Timing is observational, with no absolute pass/fail
threshold.

## Observed run

Measured on 2026-10-03 at 03:09:34 UTC, Node v24.19.0, Linux x64, in-memory SQLite:

| Reader                      | Records | Initial history JSON bytes | Median read time |
| --------------------------- | ------: | -------------------------: | ---------------: |
| Existing full-event history |     500 |                 32,865,408 |        68.953 ms |
| Projected history summaries |      25 |                      4,451 |        25.518 ms |

The summary returned `nextCursor: true`. Reading the next page produced 25
additional, distinct event IDs. No stdout, stderr, result, or input bodies were
inlined in summary rows. A separate `ledger.getEvent` call returned both full
32,768-byte streams in a 65,735-byte detail envelope; that one detail read took
2.163 ms.

The benchmark asserts a 65,536-byte maximum summary envelope, at most 25 rows,
explicit legacy identities, a continuation cursor, disjoint next-page IDs, and
successful separate detail retrieval. The actual SQLite query projection is
also covered by `tests/unit/lib/quest-run-ledger.test.js`.

Live receipt reconciliation uses `ledger.getReceiptMeta`, which selects only
sequence, runtime ID, and state. It does not load persisted inputs or result
values merely to compare revisions.

## Limits

This is a synthetic log-heavy history fixture on one warmed in-memory SQLite
executor. It does not establish production latency, network-compressed payload
size, resident runtime performance, browser rendering, or a general speedup or
no-regression guarantee. The separate browser comparison measures its own
five-job, ten-event fixture and must not be conflated with these numbers. No
Docker commands, network requests, customer data, or Quest jobs are used here.
