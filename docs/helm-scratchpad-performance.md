# Helm scratchpad input performance

## Finding and scope

The Helm page already has a bounded, deployment-scoped completion cache and a
verified live-runtime metadata path. This change preserves those paths, isolated
execution, freshness, cancellation, and production write guards.

The scratchpad composable previously used a synchronous deep watcher. Every
source edit walked the saved tab state, serialized all scratchpads (including
baseline source), and called synchronous browser localStorage before returning
to the editor. The cost grew with other saved tabs, including tabs for other
apps. At the 20-tab limit with 64 KiB sources, the persisted fixture is 2.7 MB.

The watcher now observes ref replacement without recursively walking all tabs.
Source edits schedule one save after 250 ms idle, with a one-second maximum wait
for continuous typing. Serialization happens only when saving. Tab actions and
confirmed renames save synchronously; pagehide, visibility loss, and Vue scope
disposal flush the latest state. Failed writes retain pending edits for a later
retry, without an automatic retry loop. Query results and errors remain excluded.

This improves editor input responsiveness. It does not establish the cause of a
reported cold-page-load regression or reduce the cost of an isolated Sails lift.
The final storage write still has its existing size and synchronous cost. A
crash before an autosave can lose edits made within the short pending window.

## Reproduce

Run from the repository root after installing dependencies:

```sh
node scripts/benchmark-helm-scratchpads.mjs --baseline-ref=88c53d2
```

The optional baseline ref must contain the pre-change composable; omit it to
measure just the current implementation. The script loads the real Vue
composable, changes its source 100 times in a burst, flushes via pagehide and
scope disposal, and verifies the final source was persisted. Each fixture has
one warmup followed by seven measured samples. Source sizes stay within Helm's
64 KiB execution limit, and tab counts stay within the 20-tab limit.

Storage is an in-memory stand-in. These numbers exclude real browser storage
I/O, CodeMirror updates, layout/paint, network, and app execution. A burst is
useful for comparing the input path but does not model a human typing cadence;
deterministic tests separately verify idle and continuous-typing timer behavior.

## Local measurement

Measured on 2026-10-02 using Node 24.19.0 in the cloud development environment.
These are directional local CPU results, not customer-page latency or a
cross-machine performance budget. Baseline is main commit `88c53d2`, including
the immediate verified rename-save behavior introduced by PR #660.

| Fixture          | Implementation | Per-edit p50 | Per-edit p95 | 100-edit burst p50 | Writes, including flush |
| ---------------- | -------------- | -----------: | -----------: | -----------------: | ----------------------: |
| 4 tabs × 4 KiB   | Baseline       |     0.320 ms |     0.412 ms |          34.656 ms |                     100 |
| 4 tabs × 4 KiB   | Batched        |     0.017 ms |     0.046 ms |           2.143 ms |                       1 |
| 20 tabs × 64 KiB | Baseline       |     7.410 ms |    11.627 ms |         804.089 ms |                     100 |
| 20 tabs × 64 KiB | Batched        |     0.013 ms |     0.026 ms |           1.546 ms |                       1 |

The deferred final save cost a median 0.298 ms for the small fixture and 6.826 ms
for the large fixture. The optimization removes repeated work from input; it
does not remove the need to serialize and store the latest workspace.

## Verification

`tests/unit/assets/helm-scratchpad-persistence.test.js` covers the timer bounds,
coalesced serialization, flush idempotence, save failures/retries, latest-state
capture, actual composable lifecycle cleanup, deletion, tab changes, rename
success/failure, and exclusion of runtime result data. Existing Helm browser
trials cover durable scratchpads and rename/focus behavior; run those before
claiming browser-level validation.
