# Helm completion readiness investigation

Original failure: https://github.com/sailscastshq/slipway/issues/689
CI attempt 1: https://github.com/sailscastshq/slipway/actions/runs/37297998829/job/111723734237

Baseline: current main a21374d, Node 24.14.1/macOS, Chromium via Sounding.
Unchanged focused trial passed. Twenty screenshot-paced attribute-to-method
transitions also passed; recorded accepted Enter events were 80–86 ms after
CodeMirror opened the method completion.

A bounded comparison observed the same visible-tooltip precondition every
animation frame instead of Playwright locator polling. It reproduced the exact
assertion failure on the first transition. Passive capture/bubble keyboard
records in before.json show a current selected `find` completion, active range
8–10, and correct editor focus. Enter arrived 2 ms after open; CodeMirror's
configured 75 ms interactionDelay rejected acceptance and the normal Enter
keymap inserted a newline. There was no stale tooltip in this recurrence.

This demonstrates an insufficient readiness precondition. It does not prove
that the historical Linux CI failure had the identical timing. Its original
failure is retained, and passing retries are not the basis for attribution.

The fix observes focus, active/current selected completion and its configured
interaction guard. It preserves application configuration, all original
assertions, real Enter and ControlOrMeta+Enter, and test timeouts. No sleeps.
The isolated helper inspects CodeMirror internals because public
completionStatus/tooltip visibility do not expose keyboard acceptance readiness;
a future CodeMirror internal change must update that helper, not weaken the test.

Validation:

```sh
node_modules/.bin/sounding test --file tests/e2e/pages/projects/helm.test.js --test-name-pattern='^project Helm completes models' --test-concurrency=1 --test-timeout=600000
```

Final result: desktop and iPhone 13 projects, 2/2 passed. Synthetic completion
metadata and intercepted execution responses only; Enter executes zero requests,
the platform run shortcut executes exactly one. Light/dark screenshots are
`.tmp/issue-689-{desktop,mobile}-{light,dark}.png`.
