# Bootstrap verification handle counts

These are disposable local operation counts, not production latency or capacity measurements. No native crash attribution is established.

| Source revision                            | Verification opens/closes in 17-helper prefix | Verification SQL statements |
| ------------------------------------------ | --------------------------------------------- | --------------------------- |
| `8833536f3a9999f159c574450836e5668f41c69f` | 68 / 68                                       | 10,948                      |
| `5f5b1119b49ea905d51594c9498da26f3112690f` | 4 / 4                                         | 10,948                      |

A later helper outside the scope still opens/closes four verification connections. Full catalog/receipt verification remains on every guard; there is no schema-success cache. The original measurement is retained in `original-baseline-8833536.json`.

## Reproduce

From the repository with its existing dependencies:

```sh
NODE_ENV=console SLIPWAY_RELEASE_SCHEMA_REQUIRED=1 node tests/support/count-release-schema-verification.cjs "$PWD" 8833536f3a9999f159c574450836e5668f41c69f
NODE_ENV=console SLIPWAY_RELEASE_SCHEMA_REQUIRED=1 node tests/support/count-release-schema-verification.cjs "$PWD" 5f5b1119b49ea905d51594c9498da26f3112690f
```

One identical fixture loads the three changed policy/source files from the selected Git revision without changing the checkout. Other helper sources and dependencies are unchanged between these revisions. It creates fresh synthetic release-migrated SQLite databases, invokes the actual 17-helper bootstrap prefix, and stops with a sentinel after helper 17. Model backfills are mocked. Native verification constructor, close and statement events are counted separately from working datastore connections. The sentinel exercises scope cleanup; successful completion/cleanup is covered separately by regression tests.

Environment: macOS, Node 24.14.1, better-sqlite3 12.11.1. Local sails-sqlite metadata is 0.2.6 versus lockfile 0.2.7; this fixture uses better-sqlite3 directly, not that adapter. No production database copies, telemetry, mail transport or live services are used. This does not prove production Node 22 timing, resource isolation, or a SIGBUS fix.

## Scope contract

Only the 17-helper bootstrap prefix retains handles. AsyncLocalStorage binds the scope to the exact Sails instance and async chain. Guards still inspect every catalog/receipt and compare configuration plus resolved file/device/inode identity before and after validation. The scope retains no iterator or read transaction across awaits. Guard failures poison the scope even when caught; exit revokes descendants before attempting every handle close. Outside calls retain their previous ownership and validation behavior.

This is not atomic or tamper-proof verification across four databases. The existing cross-database/time-of-check-to-use limitation remains.
