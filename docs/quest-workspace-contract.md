# Quest workspace contract (draft)

This work is the Slipway side of [#653](https://github.com/sailscastshq/slipway/issues/653). It depends on the upstream [resident Quest contract](https://github.com/sailscastshq/sails-hook-quest/issues/13). The combined fixture pins upstream source `7b713fcec6eb93b8af48611f342aaa7075c91f44` from [Quest PR #14](https://github.com/sailscastshq/sails-hook-quest/pull/14). That upstream change is not released or verified end to end here. Keep this change in draft until the real combined Sails fixture, deployment/restart, delivery-loss and process-ownership trials pass. Screenshots exercise real Slipway UI with explicitly synthetic responses; they do not prove upstream execution.

## Compatibility and activation

Released `sails-hook-quest` 0.0.5 has no compatible resident metadata/result interface. Existing apps keep bounded legacy history and lazy diagnostics, with live state **Unavailable**. Their Run, Pause and Resume controls are unavailable: a temporary Sails console does not own the resident scheduler.

New controls require both the proposed Quest v1 interface and this Slipway hook source, a verified Slipway app/deployment identity, one resident process per container, and explicit app-owned configuration:

```js
module.exports.slipway = { quest: { enabled: true } }
```

It defaults to false. The resident adapter also requires the upstream childSchedulerSuppression capability, so a hook that can start another scheduler inside a temporary Sails script bootstrap cannot activate controls. No customer dependencies, credentials or deployed app configuration are changed by this patch. Minimum published versions and upgrade instructions must be filled in after the upstream compatibility proof and release decision. Worker apps use the same resident transport; no HTTP listener is required.

The hook registers a private per-process Unix socket under `/tmp/slipway-quest-runtimes`. Directory mode is 0700; socket and identity file are 0600 and owned by the resident UID. Each call verifies app/deployment, PID start ticks, OS ownership and the resident process environment. Zero or multiple matching runtimes fail closed. The protocol permits only snapshot, named invocation, one run read, pause and resume. It cannot evaluate arbitrary code or shell commands. The helper client runs installed Node via Docker exec and never loads Sails or downloads a CLI.

## Ownership and review

Scripts and `config/quest.js` remain authoritative. Slipway does not author schedules, add a scheduler, or retry business work. Run now reviews current schema and the exact app/environment. Production runs require an explicit acknowledgement. Every mutation enforces active-team owner/admin membership, runtime identity, metadata revision, and the same authenticated app scope; calls are audited without raw input values.

An invocation has a request key scoped to the resident runtime and exact job/schema/inputs. Identical repeats return the original admission (including an unconfirmed rejection); reusing a key for different inputs fails. The bridge retains at most 1,000 keys per process and then refuses new admission until restart. This is a bounded process-local guarantee, not a distributed lock or exactly-once external side effect.

Input fields come from an allowlisted machine schema. Strings, numbers, booleans, enums and JSON-compatible objects are supported; explicitly nullable primitive inputs have a separate null choice. Only source-loaded input schemas, including a real empty schema, enable invocation; dynamic or unavailable schemas stay gated. Custom validators remain server-side. Unknown fields, unsafe shapes, more than eight nested levels, values over 16 KiB and changed schema/runtime are rejected. `false`, `0`, `null` and empty strings are not treated as omitted. Effective input precedence is `job.inputs`, then `scriptInputs` (normally extracted from the script input schema’s `defaultsTo` values), then manual overrides; Sails applies remaining schema defaults to omitted values during validation. Script schema defaults can therefore override same-named configured job inputs, as in the existing hook. For example, a configured batch size of 50 and a script default of 100 schedule with 100; a manual override of 200 affects only that invocation. No new precedence is imposed by Slipway, and a manual override never mutates the scheduled values. Effective scheduled values are separate metadata with per-field source (job input, script input, schema default or omitted), availability and sensitivity. The bridge caps value previews at 16 KiB per job. Omitted required values produce a schedule warning, not a claim that all other machine validation passed. Manual review uses safe effective source values, can deliberately retain a hidden source value, and never writes overrides back to the schedule. Unsupported hooks keep these previews unavailable. Sensitive defaults are omitted and sensitive values never become rerun defaults.

## Source schedule assessment

Schedule state distinguishes an unattempted, registered, stopped, consumed, failed,
or valid-but-unregistered timer. A missing timer is not by itself an invalid
schedule. Bounded upstream validation errors are shown separately from manual
input validation: a valid named script can still be invoked manually when its
source timer is invalid. A consumed one-shot and an expired valid date retain
that distinction. Numeric `timeout: 0` is an immediate one-shot, not a Manual
placeholder and not an execution deadline.

The hook supplies the actual effective cron timezone, including `cronOptions.tz`
precedence; an explicit null remains unavailable/parser-local rather than an
invented UTC zone. The UI preserves raw source expressions and interprets only
simple display patterns. It never calculates a timer target, validates cron, or
predicts DST itself. Actual due-at values come from the registered resident timer.

Restart descriptions come from explicit hook metadata. Relative schedules start
again at registration; wall-clock schedules are re-evaluated. One-shot behavior,
memory-only pause, and no missed-run replay are visible limits. No source schedule
or date is rewritten from the dashboard.

## Owner upgrade sequence and release gate

1. Keep incompatible apps on the read-only legacy path; do not infer support from
   a package version alone. The unreleased source still identifies as Quest 0.0.5.
2. After compatible releases exist, upgrade both `sails-hook-quest` and
   `sails-hook-slipway` in the application, review its source jobs/inputs, and deploy
   the normal app image. Slipway does not alter customer dependency manifests.
3. Explicitly enable the app-owned Quest bridge setting shown above. Verify the
   actual resident app/deployment, contract capabilities, source schema and schedule
   assessment before enabling operational use. Do not configure new credentials or
   public listeners for this channel.
4. Verify legacy history remains clearly labeled and a synthetic non-production
   job can round-trip typed input, result and logs. Review pause/restart, data-loss
   and rerun limitations before using jobs with external side effects.

The release checklist must record exact published minimum Quest and Slipway-hook
versions and replace this pending-release instruction before stable shipment.
Pinned source in a disposable integration test is not a published upgrade path.

## Runs, results and logs

The upstream synchronous `quest:job:start` event supplies the canonical run ID before child spawn. The resident bridge subscribes first and returns 202 only after observing that admission. A marked rejected-before-start validation Promise is a definite rejection and creates no execution. A corrected deliberate submission gets a new request key; ambiguous outcomes keep their original key and cannot be replayed from the dialog. Validation/HTTP/transport errors do not fabricate an execution. A disconnect detaches the viewer; it never kills or repeats the job.

`QuestRun` is an operational ledger, not a queue. Events use run ID and monotonic upstream sequence; duplicates and delayed starts cannot overwrite a terminal result. Reads are scoped to app and environment. Stable links use `?job=…&run=…`; old uncorrelated telemetry stays a separate legacy event and is never reconstructed into a run.

Completed means process exit 0. The result envelope independently distinguishes available JSON, undefined, unsupported, too large, serialization error and unavailable. A named Sails exit may still be process exit 0: display `result.exit` separately and never infer business success from the receipt, result presence or log wording. The result renderer preserves null, false, zero, empty strings and arrays. JSON-looking stdout is only a log. The result action menu copies or downloads only the retained sanitized JSON value, excluding process receipt and logs. Unsupported/undefined/unavailable values are not exported as fabricated JSON; retained truncation is explicit. An observed process signal is retained separately from its nullable numeric exit code; `SIGTERM` evidence does not imply a supported cancellation command.

Identified upstream skips are separate no-child outcomes: no start time, process exit or business result is invented. Origin is preserved when explicitly reported by Quest; otherwise it is Unknown, and a public/programmatic manual trigger does not establish a dashboard actor.

Terminal upstream logs are retained separately, including stderr warnings on exit 0. Logs are fetched only when the operator opens Logs; there is no live log-stream/replay protocol in this draft. Cancellation is unsupported and no Stop control is offered. Pause blocks future admission in the resident process but does not cancel active work or survive deployment; durable disabling belongs in source configuration. No distributed overlap, catch-up or automatic retry is advertised.

## Bounded work and retention

- UI initial page reads source detection and paginated summaries only; no Docker call or historical payload body is needed to render
- Live browser windows retain the current page, the inspected receipt and explicitly paginated history; repeated snapshots do not accumulate unlimited rows. A selected receipt outside the moving page refreshes only its small scoped summary and reloads detail/log payloads only when its evidence revision changes
- Resident snapshots are shared per app/deployment with a five-second cache and one in-flight refresh; many viewers do not cause per-viewer Sails lifts
- At most 200 jobs and 32 resident run snapshots are retained; at most four changed run payloads reconcile per refresh
- Request envelope: 32 KiB; manual inputs: 16 KiB; socket response: 512 KiB; no socket response wait exceeds five seconds
- Resident retained result: 128 KiB; stdout/stderr: 32 KiB UTF-8 each, separately marked truncated
- Existing telemetry channel: results at most 16 KiB and stdout/stderr 2 KiB each within the existing 32 KiB event budget. Larger results explicitly say too large; logs disclose truncation. An open workspace can reconcile the larger retained resident receipt, including an equal-sequence terminal payload, only from the exact verified app/runtime/run. Telemetry cannot shrink or replace that richer terminal evidence
- Database result: 128 KiB; each log tail: 64 KiB; nested values: 12 levels/4,096 nodes. Redaction happens before persistence and transmission, including declared sensitive inputs, nested secret-like keys, known environment secrets and split-chunk terminal tails
- Run/event pages default to 25 rows, max 50, stable time/ID cursor. SQL summary projection excludes payload bodies, including legacy JSON attributes
- Seven-day retention applies immediately to reads and bounded background deletion, with indexes for scope/time and expiry

Do not log arbitrary private customer data: heuristic and declared-field redaction cannot guarantee it is safe. Existing telemetry delivery is best effort; a durable spool/acknowledgement protocol is not implemented. A resident restart can lose unshipped run data and the result stays unavailable/unconfirmed rather than being rerun. A stopped app, unreadable resident transport, or an active receipt missing from a complete bounded resident snapshot each produces an explicit provisional Unconfirmed reason. None proves process termination. Exact verified resident evidence can restore Running at the same sequence; telemetry cannot perform that same-sequence restoration. New terminal evidence still reconciles normally. Reconciliation scans ID-only batches of 100 retained active receipts independently of the visible history page; repeated refreshes advance remaining batches without changing execution timestamps or sequences. Delivery-loss, restart reconciliation and real owned-process cancellation remain release blockers for the corresponding #653 guarantees.

## Verification boundary

Contract tests cover input/capability gates, correlation, bounds, redaction, permissions, idempotency and terminal monotonicity. Browser tests cover actual forms/results/navigation with synthetic responses and matched four-viewport/theme screenshot fixtures. Unit mocks and UI fixtures do not prove resident scheduler authority or process termination. The upstream and combined disposable Sails/Docker fixture results must be recorded separately before enabling the contract by default or closing #653.
