# Changelog

## 0.0.13

### Added

- Quest 0.0.8 integration for opt-in Linux live logs and confirmed cancellation of exact resident runs. Existing apps keep default behavior; capabilities and authorization determine available controls.
- Bounded sanitized durable receipt delivery. An explicitly configured private persistent directory holds at most 256 receipts/4 MiB, with a 32 KiB event limit and seven-day retention. Atomic file/directory fsync and exact-content acknowledgements preserve bounded evidence across resident/dashboard restarts.
- Bounded cumulative live-log replay: at most 32 runs, 16 snapshots/128 KiB per run, explicit truncation/replay gaps and redaction before storage or transmission. Unfinished lines and partial known-secret prefixes are withheld. Live replay memory is lost on resident restart; terminal receipts have separate durable delivery.

### Correctness and limits

- Duplicate and out-of-order receipt delivery cannot regress terminal truth. Missing acknowledgement retries evidence only; it never starts or repeats a job. Credentials are not written into the receipt spool.
- Cancellation and log transport bind app, deployment, runtime and run identity. Cancelled requires confirmed owned-process termination; natural completion and uncertain outcomes retain their actual truth. Disconnect/reconnect does not cancel or repeat execution.
- Persistence requires a mode-0700 directory owned by the app UID, unique to app/deployment and a single resident writer. Replicas need separate directories. Disk errors, full/expired storage and removed deployment volumes may lose bounded evidence. No distributed queue, second scheduler or exactly-once guarantee is added.

### App upgrade

Use Node 22+ and Sails ^1.5.0. Install `sails-hook-quest@0.0.8` and `sails-hook-slipway@0.0.13`, commit the app lockfile, then rebuild/deploy the app through its normal reviewed deployment process. Keep the existing Slipway telemetry endpoint/token and app/deployment identity configuration. No production redeploy is performed by this package release.

```js
// config/quest.js
module.exports.quest = { runtimeControls: true }

// config/slipway.js — merge into the existing Slipway configuration
module.exports.slipway = {
  quest: {
    enabled: true,
    delivery: { directory: '/app/data/quest-receipts-APP-DEPLOYMENT' }
  }
}
```

Mount that directory persistently with the required ownership/mode. Cancellation needs Linux with observable `/proc`; opaque process evidence stays unconfirmed. The dashboard alone cannot enable these hooks' capabilities. Existing default-off apps and non-Linux cancellation behavior remain unchanged.
