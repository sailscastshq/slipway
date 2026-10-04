# Quest workspace browser verification

## Evidence status

The original four before PNGs were captured from the actual Quest page at
`6fe3b2177bc867475f1e3d499f6f4de53d2d1e03`. Their materialized pixels were reviewed
at desktop light/dark and mobile light/dark before writing this trial. The frozen
fixture embedded in `tests/e2e/pages/projects/quest.test.js` was compared byte for
byte after JSON serialization with the original `quest-before-fixture-v2.json`.
It retains the original five jobs, ten telemetry events, clock, names, viewports,
and themes.

The browser suite and renewed before/after measurements must pass for the exact
proposed commit in **Quest workspace browser verification**. A workflow definition
or a build is not screenshot evidence. Do not claim an after capture, browser-state
pass, or performance improvement before downloading and reviewing that run's
artifacts. Local Chromium is installed, but the current cloud executor's browser
launch was previously blocked; this work does not retry that launch or alter
security settings. Browser execution is delegated to the CI runner.

## Measured decision and remaining gate

The bounded performance investigation used these exact sources and retained raw
observations:

- Pre-split `888c55becf293d03281c5b33a3dac09c8c0834b6`:
  [production-asset report, run 37099340264](https://github.com/sailscastshq/slipway/actions/runs/37099340264/artifacts/11264584901)
- Inspector/global-Runs extraction `8bd4994adb6f39abb57320d593a65c0b7b7681c0`:
  [initial and after-only action observations, run 37100011016](https://github.com/sailscastshq/slipway/actions/runs/37100011016/artifacts/11265519098)
- Control instrumentation head `345db484e88f7fe582a4a0665892e4ef1b4889a2`:
  [same-runner pre-split/current ABBA control, run 37100529461](https://github.com/sailscastshq/slipway/actions/runs/37100529461/artifacts/11265539912)
  and [separate original-page production comparison](https://github.com/sailscastshq/slipway/actions/runs/37100529461/artifacts/11265694490)

The control saved 17,072 initial JavaScript bytes with the inspector deferred,
but native initial-ready medians changed by only +2.05, −1.65, −1.65, and −2.60 ms
across desktop light/dark and mobile light/dark. First inspector clicks instead
rose from 12.65–12.80 ms to 30.80–31.05 ms; direct-job navigation rose by
9.75–25.30 ms. Direct-run changes were mixed. The decision is to restore eager
job-inspector loading while retaining component extraction and invocation-helper
separation. The subsequent implementation must pass the existing final-head
browser, interaction, and performance checks; these prior measurements do not
establish its results in advance.

The original-page non-regression gate remains unresolved. At `345db48`, the
separate original-page comparison measured native-ready increases of
2.95–11.70 ms and 32,355 additional initial JS/CSS bytes. Passing the existing
absolute ceilings does not turn those increases into a no-regression result.
All timings are cache-disabled, synthetic, stopped-app observations on disposable
CI runners, with native browser timing and real built assets; they do not measure
production traffic or an actual resident invocation. The actual upstream/runtime
integration gate remains independent of these passing UI trials.

## Focused preload control

The next bounded experiment targets measured late discovery of route assets,
without changing shared controls or deferring the job inspector. A production
compiler plugin emits only Quest's actual eager route dependency URLs; the server
adds allowlisted preload hints only to its initial HTML. Missing or malformed
metadata produces no hints. The plugin itself adds no client modules.

The `preload-control` job uses one exact proposed source and one production build
for off → on → on → off rounds. Its test transport removes only links marked
`data-quest-preload="1"` for the off rounds, preserving all other rendered HTML,
fixture data and assets. Reports record that intervention explicitly. Assertions
require matching source/build/requested asset identities, no duplicate static
fetches, and no new static request on the first inspector click. This separates
the preload mechanism from concurrent input and runtime correctness changes.
The original-page comparison remains separate. No improvement or non-regression
is established until actual browser artifacts are reviewed; additional feature
bytes and hint HTML remain part of the reported cost.

The first control attempt at `d3982fbd7ca1387f700a8adebd57a643de88c2c0`
([run 37115164834](https://github.com/sailscastshq/slipway/actions/runs/37115164834))
produced no current-head timing evidence: both production jobs stopped at a
navigation timeout. Direct reproduction through the installed Inertia renderer
and actual EJS template showed that its nested `locals` shadowed hints assigned
only to `res.locals`; the manifest had nine assets but the rendered page had no
hint links. The correction passes request-local hints through Inertia's returned
`data.locals`, with an actual-renderer regression. Intercepted fixture errors now
abort and report the exact failure rather than leave navigation pending. This
failed attempt is retained as failure evidence, not a performance sample.

The same head's seven browser trials passed, but pixel review found Schedule
values inheriting black text on dark panels. The scoped correction uses existing
light/dark text tokens. Scheduled and inactive Schedule captures now assert at
least 4.5:1 rendered value contrast in both themes and viewports; geometry-only
checks were insufficient. These assertions still require a new exact-head run.

The real-resident integration fixture is separate from these synthetic browser
measurements. It requires an explicitly pinned compatible upstream Quest source,
uses no customer jobs or network effects, and must prove child scheduler
suppression before execution. It remains unverified until its real Linux Docker
and browser run succeeds; the installed released 0.0.5 is not a substitute for
the unreleased contract.

## Resumed integration checkpoint

The measured source `15840330757c530174de6ba6f0574732ae43392d` includes
main `376f5fd707e0ecabc39bda1513ff7dc75ade6f44`. Its seven synthetic verification
jobs passed. The [76 state captures](https://github.com/sailscastshq/slipway/actions/runs/37152063749/artifacts/11283759740)
were source/hash verified and visually reviewed in desktop/mobile light/dark.
They include invalid schedules distinct from inactive timers and sanitized result
actions using the existing menu. Actual clipboard readback and downloaded JSON
assertions passed, with no additional execution or log request. All captures have
zero horizontal overflow; schedule values retain at least 15.13:1 light / 15.72:1
dark measured contrast. There are no separate open-menu or zero-delay screenshots.

The [production comparison](https://github.com/sailscastshq/slipway/actions/runs/37152063749/artifacts/11284855160)
uses 80 initial observations and 72 action observations. Original → current
native-ready medians, desktop light/dark then mobile light/dark, are
135.50 → 148.70, 134.85 → 142.30, 134.60 → 137.10 and 135.05 → 138.05 ms.
Initial JS/CSS is 615,716 → 670,157 bytes (+54,441), with 11 → 13 requests.
This does not meet the original-page non-regression requirement.

The separate [same-source preload control](https://github.com/sailscastshq/slipway/actions/runs/37152063749/artifacts/11284551392)
uses 80 initial and 144 action observations. Off → on native-ready medians are
123.70 → 116.55, 121.50 → 115.20, 112.35 → 107.15 and 118.15 → 112.45 ms.
Static URLs/bytes are identical, there are no duplicate requests, and no static
assets load on the first job click. Both reports' medians were independently
recomputed from their raw samples.

In the original-page comparison, static requests finish 1.85–7.25 ms earlier,
while response-end-to-content-ready remains slower in three of four views.
Controller fetch differences range from -0.20 to +3.33 ms. Extra asset-discovery
delay alone therefore does not explain the remaining increase. Raw CDP counters
are not isolated per-navigation CPU measurements, and differences between medians
must not be added into a causal budget. No speedup is inferred from a passing
absolute threshold or from the separate history-payload savings.

Real resident integration is a separate job. Its first attempts exposed missing
optional fixture Docker configuration and the dashboard's intentional disabled
workspace-link installation. Those fixture assumptions were corrected with
offline regressions. The next attempt resolved all packages and discovered the
actual hooks, then failed because Quest's asynchronous ORM initialization had not
published its API by the Sails lift callback. This is a genuine readiness gate;
no fixture sleep or fabricated API substitutes for the upstream lifecycle fix.
A complete proof artifact is emitted only after all real execution, recovery and
browser assertions pass. These failed attempts are not runtime success evidence.

## Verified real resident flow and latest UI observations

Slipway `e0d349ee0733154a64e4d9fe198585a7a7e57954`, pinned to upstream Quest
`7411223d586d1b86365296b0a696fda5477f2109`, passes all eight jobs in
[run 37157744985](https://github.com/sailscastshq/slipway/actions/runs/37157744985).
The 99.50-second real resident trial writes its final proof only after every
execution, HTTP, browser, ownership and recovery assertion completes.

The [real execution artifact](https://github.com/sailscastshq/slipway/actions/runs/37157744985/artifacts/11286144604)
was downloaded, hash-verified and its four desktop-light images inspected.
Its ZIP SHA-256 is
`e4b26a4244104ef20c9600b7dee426cebea8efb07988e09aed587bd8d1fec656`.
It proves direct resident Sails-helper parity with the separately executed Quest
child, typed/falsy/null/string values, named exits, thrown failure and SIGTERM,
source defaults and aliases, actual one-shot consumption, timer/manual overlap
and pause, request deduplication, scoped permissions and declared-input redaction.
The browser completes input review, actual HTTP admission, result-first display,
lazy stdout/stderr logs and stable-link reopen. Active HTTP SSE reader detachment,
reconnection and same-key retry do not replay work. Real resident reads recover
an active run after an unavailable target; bounded receipt eviction and a real
resident restart remain explicitly unconfirmed when evidence is lost.

The worker has no external network or HTTP listener and uses synthetic business
data. Telemetry is disabled. The proof does not restart the Slipway dashboard,
demonstrate durable telemetry/log replay, simulate a browser network outage, or
establish cancellation, distributed overlap or exactly-once external effects.
Those distinctions remain part of the acceptance review.

The preceding exact UI source `e0b2e98dd0bf5abee109f85adad0b2963104e216` has
[76 reviewed captures](https://github.com/sailscastshq/slipway/actions/runs/37157108515/artifacts/11285983698),
all with zero horizontal overflow. Four base and 66 state PNGs are pixel-identical
to the previous `1584033` set; inspected changed mobile form pixels remain clean.
All seven browser trials pass, and minimum measured schedule contrast remains
15.13:1 light and 15.72:1 dark. The later one-shot fixture change does not modify
frontend source.

The [latest production comparison](https://github.com/sailscastshq/slipway/actions/runs/37157108515/artifacts/11286018765)
was independently recomputed from its raw observations. Original → current
native-ready medians, desktop light/dark then mobile light/dark, are
138.00 → 152.35, 140.90 → 150.10, 138.10 → 143.35 and 141.85 → 143.60 ms.
Initial assets remain 615,716 → 670,157 bytes (+54,441), with 11 → 13 requests.
The original-page non-regression gate is still not met.

The [separate same-source preload control](https://github.com/sailscastshq/slipway/actions/runs/37157108515/artifacts/11285433556)
records off → on native-ready medians of 129.35 → 121.35, 131.00 → 128.35,
129.05 → 121.60 and 125.50 → 125.60 ms. Mobile-dark readiness is effectively flat;
desktop-light direct-run navigation is 3 ms slower in this run. Other direct
preload paths improve. Asset identities remain unchanged, with no duplicate or
first-click static requests. These are bounded synthetic observations, not a
universal preload speedup or a production no-regression guarantee.

## Additional delivery boundary checks

A subsequent acceptance audit found that upstream Date timestamps were being
serialized as ISO strings in telemetry wrapper fields whose ingestion contract
requires finite numbers. It also identified result bursts exceeding the total
batch budget, and escaped log strings exceeding individual wire budgets.
The correction normalizes only Quest timestamps/durations and partitions detached
telemetry buffers by serialized bytes and kind counts. It preserves ordinary
valid events exactly, with explicit bounded degradation for correlated Quest
logs/results when needed. It adds no retries or durable delivery queue.

Six pure tests drive the actual hook event handlers, JSON serialization and the
real ingest action's validation, with mocked HTTP/authentication/storage. They
cover Date/ISO/numeric timestamps, 50 near-16-KiB results without loss, count caps,
worst-case escaped diagnostics, named-exit preservation and overlapping failed
requests without replay. They are not real network or dashboard-restart proof;
that separate lifecycle fixture remains required.

## Reconstructed final acceptance candidate

The pending unpublished test helpers were lost when the disposable workspace was
reset. Five previously prepared source/document/workflow files were recovered
from Git tree `7b43a964c3ca7b98f7e5526e7dba686ca9721219` and verified against
their exact blob hashes. The missing telemetry tests, attribution harness and
native restart fixture were reconstructed and reviewed anew; this candidate is
not a byte-identical retry of the lost payload and inherits no runtime pass.

It incorporates main `1692b916f89e75cbe9914a77a49fa4daf88ffe0c`, preserving both
Quest's bounded retention and main's active/pending alert-delivery retention.
A real in-memory SQLite regression verifies the combined cleanup. A newly
reproduced Date-conversion defect is also corrected: resident and telemetry
lifecycle timestamps retain their milliseconds instead of passing Date objects
through their precision-losing string representation.

The new CI-only native fixture uses one real loopback web app and two genuine
Slipway dashboard processes over the same disposable disk databases. It tests
actual hook HTTP delivery, refused delivery during dashboard downtime,
persisted receipt/log reads before reconciliation, explicit verified resident
recovery without replay, and a bounded 36-job result burst. The previously passed
network-isolated Docker/worker/browser fixture remains separate. Both must pass
on the final candidate before those new lifecycle claims are accepted.

A temporary diagnostic job separately captures one desktop-light original/head
ABBA trace experiment. It does not change product assets, Select behavior,
readiness semantics or the ordinary production/preload reports. Instrumented
timings are diagnostic evidence only; the original-page performance gate stays
open until the actual reports and mechanism are assessed.

### First reconstructed-candidate CI observations

Published head `2a2968d9c5edc41484a1be176d0fe0e4c9982f30` has the same tree as
the locally checked candidate. Its [Quest run](https://github.com/sailscastshq/slipway/actions/runs/37227822768)
passes the existing real Docker/browser proof in 95.33 seconds and all 16
source/preflight checks. The [real evidence artifact](https://github.com/sailscastshq/slipway/actions/runs/37227822768/artifacts/11312906479)
records 26 starts, 28 Sails loads and two runtime identities. The new native
restart step fails before its first business invocation because the generated
fixture package lacks the `scripts` dictionary indexed by the installed Sails
CLI. Adding the empty dictionary preserves source-script lookup. No native
restart proof exists for this head.

The diagnostic trace job stops before capture because its pure test extractor
expects sentinels that the workflow has already removed. Its artifact contains
invalid summaries only. The test extractor now accepts both the full bounded
source and the exact extracted trial; both forms retain all instrumentation
assertions. These fixture corrections need fresh runtime CI.

The independently recomputed [ordinary production report](https://github.com/sailscastshq/slipway/actions/runs/37227822768/artifacts/11312931326)
retains ten raw observations per phase/viewport. Native-ready medians, original
to current, are 144.05 to 154.85 ms (desktop light), 142.85 to 146.55 ms (desktop
dark), 134.15 to 141.80 ms (mobile light), and 140.45 to 143.60 ms (mobile dark).
Initial JS/CSS remains 615,716 to 670,157 bytes and 11 to 13 requests. The separate
[same-source preload report](https://github.com/sailscastshq/slipway/actions/runs/37227822768/artifacts/11312476716)
records off-to-on medians of 149.25 to 148.95, 152.55 to 149.10, 146.05 to 140.10,
and 144.15 to 138.00 ms in the same viewport order. Those controls do not erase
the original-page regression. All [76 state captures](https://github.com/sailscastshq/slipway/actions/runs/37227822768/artifacts/11312911338)
have zero horizontal overflow; inspected desktop and mobile pixels preserve the
existing field styling. No new product rendering change is made in the harness
correction.

### Verified native restart and trace checkpoint

At `58b5a9c2b1477ca9429bc260ccf0fae29ad61896`, the [real resident job](https://github.com/sailscastshq/slipway/actions/runs/37228676913/job/111513547142)
passes both the Docker/browser proof (92.28 seconds) and the native web/telemetry
restart proof (20.38 seconds). The [downloaded artifact](https://github.com/sailscastshq/slipway/actions/runs/37228676913/artifacts/11313525238)
matches SHA-256 `c4608b6af08d98d83efd09db89217aa977c7632bfe72de77c1db63e507679db8`.
The native proof records two dashboard processes sharing the same disposable
SQLite files. Dashboard A is killed with SIGKILL; the web app and runtime survive.
Dashboard B preserves the old receipt and logs exactly, reports a missed receipt
as 404, then recovers it through verified private UDS with zero additional job
starts. All 36 near-16-KiB business results survive two packets. Total accepted
traffic is four requests, 80 events and 716,245 bytes, with zero rejected requests
or events. The proof reaches 41 starts, 42 loads, at most four concurrent
children, and verified cleanup of all three processes, their owned registrations
and the private database/context directory. This is actual process-restart and
explicit recovery evidence, not durable upstream replay or distributed exactly
once execution.

The separate [attribution artifact](https://github.com/sailscastshq/slipway/actions/runs/37228676913/artifacts/11313187163)
contains all 20 complete Chrome traces with `dataLossOccurred=false`. Its CI
summary failed because Chrome serializes mirrored User Timing decimal values
to 16 significant digits. The parser correction accepts only exact equality or
that exact serialization; it leaves raw Chrome timestamps, navigation/frame/thread
identity and loss checks unchanged. Replaying the same immutable traces validates
all 20, and 104 pure parser/wrapper tests pass, including the observed rounding
pair and rejection of incorrect timestamps.

All ten current-page traces place both style and layout inside the first closed
filter Select's `getBoundingClientRect` call. The read spans a diagnostic median
12.028 ms (11.138–16.170 ms), with style median 10.8485 ms and layout median
1.138 ms. All ten show later style work before first paint outside readiness;
only one shows later layout there. All ten original-page traces correctly have
no filter Select read. Readiness-induced work is tracked separately. These
instrumented spans establish the mechanism, not a speedup: avoiding the read may
move necessary work. A bounded production comparison must evaluate any proposed
closed-state measurement change while shared-control behavior remains covered.

## Reproducible comparison

The workflow uses two checkouts:

- **Before:** fixed source `6fe3b2177bc867475f1e3d499f6f4de53d2d1e03`
- **After:** the exact pull-request head SHA, or exact dispatch SHA

Only the bounded `BEGIN/END QUEST COMPARISON CAPTURE` test section is copied into
the before checkout. No Vue component, CSS, backend implementation, dependency
manifest, or generated image is transplanted into it. Each checkout installs its
own lockfile and renders its actual page through Chromium.

Both versions use:

- Clock: `2026-10-02T19:46:07.005Z` (fixed `Date`, normal browser timers)
- Desktop: 1440 × 1000, light and dark
- Mobile: 390 × 844, light and dark
- Northstar Commerce / Northstar / Alex Rivera, all synthetic
- Five jobs: scheduled, running, cron, paused, and manual
- The same ten raw telemetry events, including terminal aliases and a start event

The before receives the original raw events. The after receives the corresponding
normalized legacy events with explicit legacy IDs, and **zero correlated runs**.
A telemetry event is never promoted to a stable run to decorate the comparison.
The workspace's additional resident metadata is synthetic and explicitly declared
in the fixture adapter; no result or input value is inserted into the base
comparison. Separate state tests demonstrate those features.

### Safety and what is doubled

The application shell, routing, Vue components, CSS, browser layout, and pixels
are real. Only Inertia bootstrap JSON and Quest API/SSE transport are controlled.
The underlying test application is stopped, has no container name, and uses
synthetic users and projects. The runtime execution helper throws if invoked.
All Quest mutation routes are intercepted and recorded; an unexpected API request
fails the test. There are no Docker commands, production resources, customer
accounts, or actual scheduled job executions.

The controlled EventSource emits real JSON messages into the application's SSE
composable. Disconnect tests exercise the application's reconnection timer and
cleanup against that transport double. They do not establish socket reliability,
a deployed resident hook, or an upstream daemon integration.

## Browser checks

The proposed job runs the comparison plus interaction/state trials in the owning
Quest browser test file. The intended evidence covers:

- A selectable/searchable job list and keyboard-operable detail navigation
- Schema-based string, numeric, boolean, enum, and JSON inputs; validation retains
  entered values and cannot send a request while invalid
- Explicit production acknowledgement before dispatch, with the confirmed flag
  included in the invocation request
- Accepted/running/terminal runs distinguished from request rejection or unknown
  transport outcome
- Structured result values, named exits independent of completion, and explicitly
  unavailable/unsupported results
- Lazy run detail and log requests; stderr remains diagnostic and cannot determine
  the run's outcome
- Run again prefills prior inputs for review, requires a new production acknowledgement,
  and sends a fresh request ID with prior-run linkage only after confirmation;
  opening/cancelling review does not invoke or replace the completed result
- Stable job/run links, refresh/history navigation, and legacy event separation
- Running/overlap-disabled actions, reconnecting and unavailable runtime states
- Draft retention through an unchanged snapshot, no duplicate request on reconnect,
  and no replay from refresh or browser history
- Four viewport/theme captures and horizontal-overflow assertions

The matched before/after trial keeps the original frozen clock. Interaction
trials instead use an advancing clock anchored at that same synthetic epoch,
with fresh observations every five seconds only while the synthetic resident
stream is online. Disconnect/error/explicit stale injections stop those updates;
explicit reconnection restarts them. Intentional stale observations can be sent
without refreshing their timestamp. This matters for
Vue's event safety guard: freezing `Date.now()` makes a Button's capture handler
and bubble handler share the attachment timestamp, suppressing the bubble click.
No UI method is invoked directly to get around that behavior. Interaction
manifests record the clock mode and each screenshot's actual browser time.

The screenshots are review evidence, not perceptual image-diff assertions. A human
must inspect actual after pixels before approving the visual change.

## Measurements and budgets

Every comparison viewport records measured values in `performance.json`:

- Serialized complete Inertia initial JSON bytes
- Serialized Quest-specific initial JSON bytes
- Document response bytes
- Wall-clock navigation-to-visible-workspace-and-fonts time: five sequential
  samples per viewport, with raw values, median, minimum, and maximum retained
- Browser navigation timing when exposed (DOMContentLoaded and load events);
  unavailable entries under the clock adapter are recorded as null
- Document and workspace element counts, plus all document nodes
- Document, workspace, and open-dialog horizontal overflow

The fifth measured visit is used for each screenshot. The timing headline is
the median of all five visits; every individual sample must also meet the same
existing timing ceiling. This is a warmed navigation workload, since login has
already visited the app shell, rather than a cold-start benchmark. Initial payload
bytes are counted from the exact synthetic JSON delivered to Chromium, not from
a hand-estimated feature description. Byte measurements include the data
contract, but exclude HTTP compression and transferred JavaScript/CSS assets.
DOM counts include shared chrome; workspace counts are diagnostic because the
before and after have different structure.

The after test enforces deliberately bounded regression ceilings:

| Metric                        |       Ceiling |
| ----------------------------- | ------------: |
| Quest initial JSON            |  65,536 bytes |
| Complete Inertia initial JSON | 262,144 bytes |
| Document elements             |         4,000 |
| Navigation to ready           |     15,000 ms |
| Horizontal overflow           |          1 px |

Measurement version 2 uses identical synthetic-stream readiness waits and the
same number of browser-driver reads in both phases, with identical timing
boundaries. Earlier reports at `4abe30e` and `17cc4c7` included an extra wait in
after; their small timing deltas are not evidence of a UI-only regression. The
screenshots, JSON sizes, and DOM counts from those reports remain valid.

These are budgets, not measured results. The comparison job verifies fixture
identity and emits both observed values for each viewport. Independent CI runners
and first-render noise make the timing descriptive. No speedup percentage is
claimed. The old source's 500-event history bound and 30-second polling are
architecture context only: the ten-event transport fixture does not benchmark
that workload, production traffic, discovery latency, or a real runtime.

### Supplemental same-runner timing

The separate `paired-navigation` job keeps baseline and exact proposed source in
sibling checkouts, installs each lockfile, and copies only the same bounded capture
trial into each. It runs before → after → after → before sequentially on one
runner, with a fresh normal Sounding/application/browser lifecycle for each
round. This reduces host-to-host differences and balances order; it does not reuse
an application process, substitute the proposed UI into baseline, or change any
fixture, readiness assertion, timing boundary, or budget.

Each round retains all five navigation samples per viewport. The supplemental
report shows all four rounds and the median of ten observations per phase, along
with exact source and trial SHAs, initial payloads, DOM counts, and original
ceilings. Screenshot review continues to use the existing before/after artifacts.
Two rounds per phase on one executor remain descriptive: dependency differences,
development-server behavior, and host noise are included. This is neither a
production benchmark nor a general no-regression guarantee.

### Production-built asset decomposition

`production-navigation` adds an isolated ABBA diagnostic without changing the
original screenshot or interaction jobs. A separate process calls the installed
Shipwright hook with `NODE_ENV=production` to build each exact checkout's real
assets. No application is lifted in that process. The following Sounding process
uses its normal explicit **test** environment, disposable datastores, disabled
Quest/Lookout hooks, stopped fixture app, and runtime-execution trap. Only the
benchmark checkout's Sounding lift config disables development asset middleware
and uses Shipwright's actual manifest tag generators. ORM safety guards remain
unchanged. Running the application itself with production `NODE_ENV` is forbidden
here: it conflicts with the disposable test datastore's migration policy.

The benchmark alone replaces Date with a fixed-origin Date-only shim. Timers,
`performance`, Navigation/Resource/Paint Timing, and CDP stay native. A page-side
ready mark waits for the actual Quest heading, first job, phase-specific visible
root, synthetic stream, fonts, and two animation frames. The existing driver
assertions still run. Reports retain full wall times, native response-end and
ready marks, resource paths/counts/bytes, paints/long tasks, and raw CDP snapshots.
`route.fetch()` and subsequent bootstrap rewrite are measured separately; the
real stopped-app controller and database work remain inside end-to-end timing.
Raw CDP counters may reset across navigation, so no cross-navigation deltas are
calculated and no parser-only cost is claimed.

Playwright route interception disables HTTP cache for both phases. These are
identical uncached synthetic initial navigations with production-built assets,
not a warm-cache SPA or live production benchmark. All original byte, DOM,
readiness, and overflow ceilings remain in force; raw observations and any
increase must be reported rather than explained away by those ceilings.

The production job also records an explicitly after-only path trial. Each fresh
page measures the first genuine inspector click, a direct job link, and a direct
job/run link, three times per viewport in each after round. It uses an advancing
Date-only clock and a separate synthetic fixture with one completed correlated
run. Readiness is recorded in the browser when the visible inspector's Run control
is usable or the direct run's structured result is present. Native timing, real
bootstrap fetches, and requested resource paths/bytes are retained; no invocation
is submitted. These paths have no old-page inspector equivalent, and no action
regression or improvement is inferred without a separately measured pre-split
control. This prevents newly deferred initial code from disappearing from review.

### Bounded pre-split action control

The separate `pre-split-control` job compares exact pre-split source
`888c55becf293d03281c5b33a3dac09c8c0834b6` against the current head on one runner in
pre-split → current → current → pre-split order. It builds each source's own
production assets and copies only the same updated test/instrumentation companion
into both checkouts. Both use the workspace fixture (`after` transport adapter),
including the same after-only interaction fixture and native clocks. No UI,
backend implementation, styles, or dependency files are transplanted.

The report validates exact source/trial identities and unchanged fixture/budgets,
then retains initial navigation and first-click/direct-job/direct-run samples for
both implementations. The old-screen before/after comparison remains a separate
job with its original pinned source. This control can expose a tradeoff between
initial work and deferred pane loading; it does not erase a measured regression
against the original page or establish production traffic performance.

## Running and reviewing

On an authorized disposable browser-capable runner with dependencies installed:

```sh
SLIPWAY_QUEST_CAPTURE_PHASE=after \
  node_modules/.bin/sounding test \
  --file tests/e2e/pages/projects/quest.test.js \
  --test-concurrency=1 --test-timeout=600000
```

Prefer the workflow for paired capture because it enforces exact source identity
and isolates before from after. Download these artifacts from the same run:

1. `quest-before-6fe3b2177bc8`
2. `quest-after-<exact-head-sha>`
3. `quest-workspace-states-<exact-head-sha>`
4. `quest-comparison-report-<exact-head-sha>`
5. `quest-same-runner-navigation-<exact-head-sha>` (supplemental timing)
6. `quest-production-navigation-<exact-head-sha>` (production-asset decomposition)
7. `quest-pre-split-control-<exact-head-sha>` (bounded optimization tradeoff)

Inspect all four PNG pairs at their actual dimensions. Check typed form, result,
failed, running, reconnecting, disconnected, and keyboard state captures. Confirm
both `fixture.json` files share the clock/jobs/events/viewports, confirm after
`sourceSha` is the reviewed head, and read the measured report. Failure diagnostics
are separately retained for 14 days; review artifacts are retained for 90 days.

Backend request/contract tests and upstream resident integration are independent
gates. A browser mock pass alone cannot establish that a running app supports
invocation, scheduling, typed metadata, result serialization, or durable run IDs.
