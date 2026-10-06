# Slipway 0.0.88

This release follows verified main `d19103230f074d46d515d1b43dfb3ee3ea314f2a`. It ships the current tested dependency tree. Release preparation changes only the server version declarations and these notes; it does not upgrade dependencies or deploy an installation.

## Changes since 0.0.87

- **Safer server updates through the existing Docker/Bosun path.** Internal SQLite schemas migrate before ORM lift through the shared native migration executor. Four datastores have immutable schema manifests and transactional receipts. Clone preflight, private verified local backups, writer admission, bounded recovery and receipt-aware health checks protect the existing updater. Restart reconciles committed schema/receipts instead of blindly replaying work. Production startup schema helpers verify registered readiness instead of issuing competing DDL. No separate host bundle, migration daemon or coordinator UI is required.
- **Direct recovery evidence.** Real competing-process SQLite contention, interrupted/corrupt backups, lost COMMIT results before and after a real commit, owned-process interruption and hot-journal restart are tested. Three small and three 64 MiB fixtures externally sample journals, live growth, clones and backups. Sampling gaps and test-only holds are disclosed; sampled filesystem peaks are not physical-device maxima or production performance guarantees. The published 0.0.87 updater and fresh production-volume boot are exercised in disposable Linux CI.
- **Quest reconnect, receipts and controls.** The dashboard adds capability-gated live-log viewing, cancellation admission and durable receipt acknowledgements. Streams enforce current team/app/deployment authority, bounded viewers and buffers, and redaction before storage or transmission. Cancelled requires confirmed owned-process termination; uncertain ownership or termination stays Unconfirmed. Evidence retries never start or repeat jobs, and disconnecting a viewer never cancels a run. Natural completion retains its actual result.
- **Quest workspace clarity.** Authoritative initial loading, established filter/input styling, selected-app truth, typed input and result handling, stable run links and running-job disclosure make operational state clearer. Pausing affects future admission rather than cancelling active jobs. Legacy or unavailable capabilities remain explicit.
- **Helm and navigation corrections.** Command mode has clearer query guidance and JSON validation. Completion keyboard tests respect the configured interaction guard. Quest 0.0.7 compatibility fixes support database-free commands. Platform tools preserve selected apps and return breadcrumbs.
- **Profile and editor improvements.** Own-account photo uploads receive native decode/normalization and storage validation. Profile sections and account inputs are clearer. Bridge toolbar actions preserve pending native text selection; writing surfaces avoid distracting focus outlines while keyboard toolbar and image-selection outlines remain available.
- **Variable menu fields use actual Klean controls.** Value type and preview policy keep one aligned caret beside their value and retain dashed bottom borders. Desktop/iPhone, light/dark and nested-popover keyboard flows are covered.
- **Bounded dependency maintenance already on main.** Compatible Sails compression, Express proxy-addr and source-map-js patches are retained. The unused development diagnostics hook and its 43 exclusive lockfile nodes were removed; `/dev` intentionally returns 404 while development assets and Vue HMR remain supported.

## Installation and server update

The server artifact is `ghcr.io/sailscastshq/slipway:0.0.88`, published by the existing Release workflow after full verification and packaged-module smoke tests. The installer resolves the latest GitHub release or accepts the explicit version `0.0.88`. Existing installations use the normal authenticated Update action and `slipway-bosun` sidecar path. Keep normal backups and persistent datastore volumes. No production installation is upgraded by publishing this release.

The Node server/build toolchain requires Node 22.20+ on the 22.x line, or 24.12+. Docker installations use the packaged runtime. See [Bosun release updates](bosun-release-updates.md) for schema adoption, recovery and update scope.

## Application hooks and Quest rollout

A dashboard update alone cannot enable new app capabilities. Quest **0.0.8** is published; Slipway hook **0.0.13** is prepared in source but its separate npm publication is held at release preparation. Registry latest remains **0.0.12**. Do not treat the prepared package version as an available registry upgrade. Existing app hook behavior and capability checks remain supported; live control and durable delivery require the compatible app hooks and normal app rebuild/redeployment after hook publication.

For that separately coordinated rollout, use Node 22+, Sails ^1.5.0, Quest 0.0.8 and Slipway hook 0.0.13, the existing telemetry configuration, and explicit app-owned opt-ins. `quest.runtimeControls: true` requires Linux with observable `/proc` for verified cancellation. `slipway.quest.enabled: true` and durable delivery require a private persistent mode-0700 directory owned by the app UID, unique to app/deployment, with one resident writer. Actual advertised capabilities are authoritative. Disk errors, expiry, removed volumes and opaque process ownership can leave evidence unavailable or termination Unconfirmed. There is no distributed queue or exactly-once guarantee. See [Quest reconnect and control rollout](quest-milestone-c.md).

## Residual dependency advisories

Kelvin explicitly authorized shipping this release with the current tested dependencies on 6 October 2026. This is a release decision, not remediation or a claim that the advisories are harmless. The fresh committed-lockfile audit reports **nine entries: two critical, four high and three moderate**, representing three unresolved underlying advisories:

- **proxy-addr 1.1.5**, through sails-hook-sockets 3.0.2: [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h). The checked-in trust-proxy configuration supplies an Express function; the advisory's malformed-subnet compilation condition has not been established for that configuration. The sockets dependency chain remains unresolved.
- **braces 3.0.3**, through Shipwright → fast-glob → micromatch: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Shipping asset discovery uses repository-owned patterns. Development dependencies are present in the image and startup/build exposure is retained; this is not a dev-only harmlessness claim.
- **sprintf-js 1.1.3**, through Sails → i18n-2: [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). Repository-owned locale/message sources were identified; attacker-controlled precision strings were not established. The chain remains unresolved.

[Issue #647](https://github.com/sailscastshq/slipway/issues/647) remains open for follow-up. No audit fix, dependency override, forced upgrade or blanket audit waiver is included in this release preparation. See [dependency audit evidence](dependency-audit.md) for paths and exposure assessments.

## Verification

The selected main commit passed the full Tests workflow and both ancillary workflows. The exact version commit and release workflow must also pass full verification before installation/update availability is reported. The Release workflow verifies the tag/package version match, builds the container, smoke-loads packaged Helm/Wake modules and pushes the versioned image plus the moving tags. Exact commit, workflow and registry artifact receipts are recorded in the published GitHub release.
