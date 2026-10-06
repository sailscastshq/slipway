# Quest reconnect and control rollout

This draft implements the bounded Milestone C work in issue #653. Scripts and
Quest remain the scheduler. Receipt retries deliver evidence only; they never
run a script, catch up missed schedules, or promise exactly-once side effects.

## Compatibility

Released Quest **0.0.7** has terminal logs and no cancellation API. Released
Slipway hook **0.0.12** has no durable spool/live replay. A server update alone
cannot grant these capabilities. The candidate upstream source is pinned in CI
and must pass real process/combined consumer verification before coordinated
package publication. Proposed next minimum releases are Quest **0.0.8** and
Slipway hook **0.0.13**, subject to the separate publication decision; neither is
claimed to exist. Owners must install the compatible hooks and deploy their app.
Actual contract capabilities are authoritative, including for newer versions.

Existing apps keep default behavior. Opt in to upstream controls in app source:

```js
module.exports.quest = { runtimeControls: true }
```

Controls currently require Linux `/proc` evidence. Mac/Windows cancellation stays
unsupported. Run IDs, process-local overlap and source schedule ownership remain
unchanged. Live output consists of cumulative bounded tails, at most four
upstream snapshots per second. Slipway redacts assembled tails before storage or
transmission, holds unfinished lines and partial declared-secret prefixes, and
retains at most 16 snapshots/128 KiB for each of at most 32 runs. Truncation and
replay gaps explicitly mean earlier logs are unavailable. Terminal logs/results
retain their separate durable receipt; replay memory is lost on resident restart.

Live log SSE reads require active team/app authorization, exact owning deployment
and runtime identity. Shared one-second scoped reads coalesce viewers; server
streams are capped at 128 and disconnect/tab changes clean up subscriptions.
Reconnecting detaches/reattaches a viewer and never cancels or repeats execution.

## Durable receipt delivery

The app owner supplies a private persistent directory unique to app/deployment:

```js
module.exports.slipway = {
  quest: {
    enabled: true,
    delivery: { directory: '/app/data/quest-receipts-APP-DEPLOYMENT' }
  }
}
```

The app UID must own it with mode 0700. Receipts are sanitized before being
written, mode 0600, atomically renamed after file fsync and directory fsync.
Credentials are used at request time and never written into the spool. The
spool holds at most 256 receipts/4 MiB, with a 32 KiB event limit and seven-day
retention. It sends at most eight receipts per ten-second retry, with one request
in flight and bounded response/timeout. Acknowledgement contains exact-content
IDs only after the environment-token-authorized app/deployment ledger accepts
that receipt. Duplicate and out-of-order deliveries cannot regress terminal
state and do not create duplicate legacy metrics. Missing/failed acknowledgements
retain evidence. Full storage, disk errors and expiry disclose evidence loss;
application health and business execution do not wait for remote delivery.

Persistence survives app/Slipway process restart only while this directory and
its deployment identity remain available. Container removal, ephemeral tmpfs,
expired receipt windows and an unavailable disk can lose evidence. This is
bounded delivery, not a distributed durable queue or an exactly-once guarantee.

## Cancellation

The operator reviews an explicit cancellation request. The owning executor
records its actual child PID/start ticks, UID, session/group and run ID; signals
only that verified group, then observes termination. Duplicate requests coalesce.
The UI shows Cancelling after resident admission and Cancelled only from confirmed
termination. TERM-resistant children may receive a separately ownership-checked
KILL. Changed identity, permission failure, escaped tagged descendants or the
five-second confirmation deadline remain Unconfirmed. The overlap guard remains
held for unconfirmed termination. Every control is scoped and audited. Results
from normal completion races remain Completed.

External side effects may already have happened. Arbitrary daemonized children
that deliberately shed run identity cannot receive a process-tree guarantee.
Such jobs should keep this capability disabled and use app-owned reconciliation.
There is no automatic rerun after cancellation, interruption, timeout or unknown
outcome. Run again is a deliberate new input review against the current schema.

## Proof requirements

Focused tests cover private storage/restart, exact acknowledgement, bounds,
redaction, replay gaps and terminal monotonicity. Exact-head Linux Quest CI proves
actual Sails child logs, duplicate requests, TERM/KILL confirmation, forged/reused
PID rejection and escaped descendants. The combined packed-hook fixture proves
resident HTTP controls and persisted cancellation; the disk-backed dashboard
restart fixture proves actual refused telemetry followed by receipt delivery
without resident recovery or repeated business work. Browser evidence must cover
both themes and mobile/desktop, disconnect/reconnect and repeated controls before
this draft is accepted. Issue #653 remains open until these proofs pass.
