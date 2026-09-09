# Canonical schema container fixture

Build using a local Linux Slipway image containing Sails and its SQLite adapter:

```sh
docker build --build-arg SAILS_FIXTURE_BASE=slipway-local:latest -t slipway-schema-fixture:369 tests/fixtures/schema-snapshot
SLIPWAY_SCHEMA_FIXTURE_IMAGE=slipway-schema-fixture:369 node scripts/verify-schema-container-parity.js
```

The verifier creates only a disposable fixture container, compares its running
and stopped snapshots, and removes it and its anonymous volumes afterwards.
It checks physical uniqueness, numeric identity, string/numeric foreign keys,
and disabled timestamps. Source code is identical in both states. No production
container or database is needed.
