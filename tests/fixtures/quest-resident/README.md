# Real resident Quest integration

This fixture uses the explicit pinned upstream Quest source, installed
Sails/whelk, the complete Slipway hook, actual Docker exec/private UDS transport,
a disposable Sounding HTTP world and Chromium. No runtime double, fabricated
lifecycle event, intercepted browser response or customer job is used.

Run only on the authorized disposable Linux CI runner with installed lockfile
dependencies, Chromium and the already-provisioned `node:22-bookworm-slim` image:

```sh
SLIPWAY_QUEST_UPSTREAM_ROOT="$PWD/.tmp/quest-upstream" \
SLIPWAY_QUEST_UPSTREAM_SHA=<verified-full-upstream-sha> \
node_modules/.bin/sounding test \
  --file tests/contracts/quest-resident-integration.test.js \
  --test-concurrency=1 --test-timeout=600000
```

The upstream checkout must be clean and match the asserted full SHA. CI prepares
its pinned production dependencies separately. The source overlay and its own
dependencies are read-only; the fixture application's Sails/machine/whelk resolve
through the root lockfile dependency mount. Missing source is a failure, never a
skip or a fallback to released 0.0.5. The known unsafe `788d767` implementation is
blocked; readiness also demands explicit scheduler-suppression, trigger and
terminal-exit-code/terminal-signal/schedule-diagnostics capabilities and source-loaded job metadata.

The writable app tmpfs owns its `node_modules` link directory. It links the
installed dependencies and explicitly links the pinned Quest source and local
`packages/hook`; it does not depend on npm installing workspace links. Both
container startup and offline checks resolve all declared fixture dependencies
and peers from their actual package locations, including the normal Sails CLI.
The offline probe also calls the installed Sails moduleloader on that layout
and checks the shared source-owned `.sailsrc` enables all four discovered hooks.
It loads hook definitions only; it does not initialize any hook or lift Sails.

The worker uses real `sails.lift()` with helpers/ORM and no HTTP hook. The full
Slipway hook auto-registers on `ready`; Quest owns every validation, child and
timer. The source enables resident auto-start. A passive observer verifies that
owned temporary CLI bootstraps disable it at ORM readiness. It never rewrites
the setting to make an unsafe hook pass.

Docker runs with network `none`, a read-only root/source/dependencies, and writable app/tmp tmpfs state.
Only one unique container is created or removed. The supervisor permits one
owned-resident restart, caps the complete fixture at four minutes, and stops
the container if evidence exceeds 256 KiB or Sails loads/starts exceed 40. No
host process lookup or broad cleanup is used.

Coverage includes source aliases/default precedence, actual stable timer due-at,
typed/falsy/nullable inputs and independent business results, Sails validation,
named exits, throwing scripts, stderr on exit 0, request-key dedupe, scheduled and
manual overlap/pause, process/socket ownership, real authentication and privacy,
browser review/result/log/stable-link reopening and disconnect without replay.
A synthetic job signals only its own PID to prove observed SIGTERM propagation
with no invented numeric exit code; it does not exercise a cancellation API.
Malformed cron, a valid expired date, a stopped interval and a bounded consumed
one-shot remain distinct. Yearly paused cron definitions verify `cronOptions.tz`
precedence and an explicit local-default timezone without waiting for their dates.
An invalid schedule does not prevent an independently validated manual run.

Recovery trials intentionally mark only the disposable dashboard App stopped or
temporarily point it at a uniquely nonexistent container while a real child
keeps running. They require uncertainty and exact same-sequence resident recovery
without replay. A separate test withholds real terminal delivery, then uses a
single bounded fixture signal to create 40 genuine paused Quest timer skips at
100 ms intervals,
evicting the old resident receipt without new children or a runtime restart.
The timer stops afterward; its dynamically unavailable schema stays gated.
Finally the supervisor replaces the actual resident, proving stale-identity
rejection and persisted uncertainty rather than an invented result or retry.

Telemetry is disabled. This proves bounded resident reconciliation and truthful
lost evidence; it does not claim durable replay, cancellation, distributed locks
or exactly-once external effects. The only business data is synthetic.

Screenshots plus browser and complete integration proof JSON are written under
`.tmp/screenshots/quest-real-resident`. Complete proof is written only after all
assertions pass. Syntax/offline checks are not runtime execution evidence.

Offline source/schema checks need no socket, scheduler, browser or business child:

```sh
NODE_PATH="$PWD/node_modules" \
SLIPWAY_QUEST_UPSTREAM_ROOT="$PWD/.tmp/quest-upstream" \
SLIPWAY_QUEST_UPSTREAM_SHA=<verified-full-upstream-sha> \
node --test tests/fixtures/quest-resident/preflight.test.cjs \
  tests/fixtures/quest-resident/source-metadata.test.cjs
```
