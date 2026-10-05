# Slipway 0.0.87 release candidate

This candidate follows merged main `d232f184eb31ad54ac69b83931e17c0b0bea010c` and prepares Slipway 0.0.87, `sails-hook-slipway` 0.0.12, and `slipway-cli` 0.0.3. These version declarations are not publication evidence. The server release and any verification override remain held for maintainer approval.

## Changes since 0.0.86

- The Quest workspace connects to the application's resident scheduler, exposes source jobs and typed inputs, separates results from logs, and retains scoped run receipts, stable links, and bounded history summaries. Reconnecting does not rerun jobs. Pause affects future admission in the current process and does not cancel active work or persist across restart.
- Resource warnings identify CPU or memory, observation time, Docker measurement basis, recovery rules, and the affected container. Independent delivery adds deduplicated recipients, hashed destination receipts, isolated failures, bounded batches, capped retry, disabled/re-enabled handling, restart/lease handling, and recovery/supersession guards. Already acknowledged destinations are skipped; external delivery is not exactly-once.
- Inertia forms and router mutations now cover settings and variables, service resources/name and external/custom service settings, backup-storage Save, token revocation, release flags, Helm library/history, Wake settings/visitor deletion, and Bearing votes. Shared controllers preserve REST contracts and authorization. Validation, failed/unconfirmed saves, keyboard interaction, and restored page state are covered by browser and request tests.
- CLI application logs and noninteractive commands use existing server streams and guarded Helm execution. JSON/NDJSON, structured errors, exit status, explicit targeting, stdin/file inputs, doctor, app inspection/restart, cancellation/history, single-use arming, and private execution receipts support routine operations. Arms remain bound to exact source and deployment; tokens are not printed or passed in argv.
- Helm command/runtime, prompt/completion, scratchpad focus and batched autosave improvements; guided restore tests using isolated temporary databases; clearer storage feedback; Bearing save errors and launcher closing; migration/schema inventory and Caddy/Lookout rehearsal corrections; Bridge navigation naming; compact deployment notifications; compatible dependency updates.

## Upgrade and additive data changes

Resident Quest controls require `sails-hook-quest` **0.0.6 or newer**, `sails-hook-slipway` **0.0.12 or newer**, ORM-enabled Sails, one verified resident process, and explicit `slipway.quest.enabled=true`. Older hooks retain bounded legacy history with unavailable resident controls. Owners review their source jobs and configuration before normal application deployment; this release preparation changes no deployed app dependencies or settings.

Startup's observability migration adds `resource_alert_deliveries` and `quest_runs`, with two indexes each. It does not alter or drop existing observability tables. Retain normal database backups and the previous-release upgrade proof. See [alert delivery and migration](resource-alert-delivery.md) and [Quest workspace contract](quest-workspace-contract.md).

Quest 0.0.6 can block Sails initialization when ORM is deliberately excluded. The user accepted this limitation for the current release, and [Quest issue #16](https://github.com/sailscastshq/sails-hook-quest/issues/16) remains open. The original fixture and failed check remain unchanged. This acceptance does not turn full CI green. Residual dependency issue #647 remains nonblocking under the user's release decision.

## Recorded performance tradeoffs

The documented synthetic comparison at `e9ef653a` measured original/current initial readiness medians of 121.20/127.15, 121.95/129.10, 117.85/121.95, and 117.45/130.75 ms for desktop light/dark and mobile light/dark: increases of **5.95, 7.15, 4.10, and 13.30 ms**. Initial JS/CSS increased **54,768 bytes**, resource requests went from 12 to 14, and initial JSON from 4,283 to 5,650 bytes. These are uncached synthetic navigations with production-built assets, not live production measurements or measurements of this candidate SHA. The latency increase remains visible; no general UI speedup is claimed.

A separate log-heavy history fixture reduced initial history JSON from 32,865,408 bytes for 500 complete events to 4,451 bytes for 25 summaries plus cursor; median reader time was 68.953/25.518 ms. This measures history projection, not whole-page rendering. The alert collector's separate synthetic healthy comparison adds no outbox reads/writes and approximately 5.39 microseconds per 50-container cycle, excluding Docker/network latency. Sources: [Quest verification](quest-workspace-verification.md), [history budget](quest-history-budget.md), and [collector evidence](evidence/resource-alert-collector-benchmark.json).

## Publication gates

Merged main's [Tests 37280919032](https://github.com/sailscastshq/slipway/actions/runs/37280919032) is terminal with 17 passing jobs and only the accepted no-ORM Helm runtime failure. Verify the exact version candidate again and keep the failed evidence visible. No runtime, test, assertion, timeout, or workflow patch is included in this preparation.

After authorized hook publication, verify a clean registry-installed Quest 0.0.6/Slipway-hook 0.0.12 consumer, package integrity/source provenance, and actual resident capabilities. The earlier npm-packed source proof does not replace this gate. Verify the final CLI tarball's installed version, help, JSON errors and exit status, and package ownership.

The existing Release workflow has no per-test exception input. Normal verification inherits the accepted failure; `skip_verification=true` skips the entire verification wrapper and is documented as maintainer-hotfix-only. The one-time override question is unanswered. Do not dispatch that override, publish the server release, or infer approval from acceptance of Quest #16. Coordinate all main version pushes, tags, and package publication with the parent before acting.
