# Quest workspace contract (draft)

This work is the Slipway side of [#653](https://github.com/sailscastshq/slipway/issues/653). It depends on the upstream [resident Quest contract](https://github.com/sailscastshq/sails-hook-quest/issues/13). That upstream change is not released or verified end to end here. Keep this change in draft until the real combined Sails fixture, deployment/restart, delivery-loss and process-ownership trials pass. Screenshots exercise real Slipway UI with explicitly synthetic responses; they do not prove upstream execution.

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

Input fields come from an allowlisted machine schema. Strings, numbers, booleans, enums and JSON-compatible objects are supported; explicitly nullable primitive inputs have a separate null choice. Only source-loaded input schemas, including a real empty schema, enable invocation; dynamic or unavailable schemas stay gated. Custom validators remain server-side. Unknown fields, unsafe shapes, more than eight nested levels, values over 16 KiB and changed schema/runtime are rejected. `false`, `0`, `null` and empty strings are not treated as omitted. Source-owned defaults and scheduled input precedence remain Quest's responsibility; no new precedence is imposed by Slipway. Effective scheduled values are separate metadata with per-field source (job input, script input, schema default or omitted), availability and sensitivity. The bridge caps value previews at 16 KiB per job. Omitted required values produce a schedule warning, not a claim that all other machine validation passed. Manual review uses safe effective source values, can deliberately retain a hidden source value, and never writes overrides back to the schedule. Unsupported hooks keep these previews unavailable. Sensitive defaults are omitted and sensitive values never become rerun defaults.

## Runs, results and logs

The upstream synchronous `quest:job:start` event supplies the canonical run ID before child spawn. The resident bridge subscribes first and returns 202 only after observing that admission. A marked rejected-before-start validation Promise is a definite rejection and creates no execution. A corrected deliberate submission gets a new request key; ambiguous outcomes keep their original key and cannot be replayed from the dialog. Validation/HTTP/transport errors do not fabricate an execution. A disconnect detaches the viewer; it never kills or repeats the job.

`QuestRun` is an operational ledger, not a queue. Events use run ID and monotonic upstream sequence; duplicates and delayed starts cannot overwrite a terminal result. Reads are scoped to app and environment. Stable links use `?job=…&run=…`; old uncorrelated telemetry stays a separate legacy event and is never reconstructed into a run.

Completed means process exit 0. The result envelope independently distinguishes available JSON, undefined, unsupported, too large, serialization error and unavailable. A named Sails exit may still be process exit 0: display `result.exit` separately and never infer business success from the receipt, result presence or log wording. The result renderer preserves null, false, zero, empty strings and arrays. JSON-looking stdout is only a log.

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

Do not log arbitrary private customer data: heuristic and declared-field redaction cannot guarantee it is safe. Existing telemetry delivery is best effort; a durable spool/acknowledgement protocol is not implemented. A resident restart can lose unshipped run data and the result stays unavailable/unconfirmed rather than being rerun. Reconciliation scans ID-only batches of 100 retained active receipts independently of the visible history page; repeated refreshes advance remaining batches without changing execution timestamps or sequences. Delivery-loss, restart reconciliation and real owned-process cancellation remain release blockers for the corresponding #653 guarantees.

## Verification boundary

Contract tests cover input/capability gates, correlation, bounds, redaction, permissions, idempotency and terminal monotonicity. Browser tests cover actual forms/results/navigation with synthetic responses and matched four-viewport/theme screenshot fixtures. Unit mocks and UI fixtures do not prove resident scheduler authority or process termination. The upstream and combined disposable Sails/Docker fixture results must be recorded separately before enabling the contract by default or closing #653.
