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

Inspect all four PNG pairs at their actual dimensions. Check typed form, result,
failed, running, reconnecting, disconnected, and keyboard state captures. Confirm
both `fixture.json` files share the clock/jobs/events/viewports, confirm after
`sourceSha` is the reviewed head, and read the measured report. Failure diagnostics
are separately retained for 14 days; review artifacts are retained for 90 days.

Backend request/contract tests and upstream resident integration are independent
gates. A browser mock pass alone cannot establish that a running app supports
invocation, scheduling, typed metadata, result serialization, or durable run IDs.
