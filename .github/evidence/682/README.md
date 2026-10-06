# Bridge pending native selection investigation

Original release failure: https://github.com/sailscastshq/slipway/issues/682
https://github.com/sailscastshq/slipway/actions/runs/37287385600/job/111689412056

Baseline: main a21374d, Node 24.14.1/macOS, Chromium via Sounding.
The unchanged original journey passed, as did passive event recording and a
six-times browser CPU-throttled comparison. Those passes do not establish a fix.

The bounded accelerated gesture sends real Shift+Home and invokes the actual
Bold toolbar handler at Home keyup, before the browser selectionchange delivery.
Passive before.json records show the selected DOM text while ProseMirror still
has a collapsed cursor. Bold only sets storedMarks; paragraph HTML remains plain.
The original first p strong assertion fails. after.json shows the same gesture
with synchronous observer reading: editor selection is updated and Bold formats
the selected paragraph. This proves the pending-selection runtime gap; it does
not establish which stage failed in the historical Linux release run.

The fix flushes pending editor DOM/selection observations before toolbar
transactions, bookmarking a link/image range, or moving focus to the toolbar.
No delay, timeout change, selection-forcing test checkpoint, or assertion removal.
The original owning journey is unchanged. The regression records the actual
browser selection and stale editor cursor before formatting, then checks Bold,
Markdown/Visual preservation and later Enter on desktop and iPhone 13 projects.

Validation:

```sh
node_modules/.bin/sounding test --file tests/e2e/pages/projects/bridge-rich-text-selection.test.js --file tests/e2e/pages/projects/bridge-resource-contract.test.js --test-concurrency=1 --test-timeout=600000
```

Final result: 3/3 passed. The final new desktop regression also fails on unpatched
main at p strong, while its native-selection precondition passes. The patched
source was restored byte-for-byte after this baseline comparison.
Synthetic local metadata/records only; no production commands or data writes.
Screenshots: `.tmp/screenshots/issue-682/{desktop,mobile}-{light,dark}.png`.

## Approved focus-decoration correction

The delivered focused screenshot showed the global `*:focus-visible` brand
outline on the rich-text contenteditable surface, overriding `outline-none`.
The wrapper also applied a focus-within outline. The correction excludes only
`[data-slot="rich-text-content"]` through zero-specificity `:where()` so unrelated
controls retain the original focus-rule cascade, and removes only
the wrapper outline utilities. Toolbar focus, borders, disabled states and
selected-image outlines remain intact.

Refreshed against main `23cefa7c38c3421f317e94b28e112c6f314a84c5` with its exact
lockfile installed. The unchanged original journey and desktop/mobile regression
pass 3/3 (25.45s). Added real Alt+F10, ArrowRight and Escape checks verify visible
keyboard focus on toolbar controls and return to the same editor selection.
Light/dark captures assert actual editor focus with no surface/wrapper outline.
The same four existing Library screenshot identities are replaced, not copied.

## Combined CI login precondition

On combined head `a04da27e`, CI run `37457088094` failed the unchanged
`loading-state.test.js` Migrate-tab lookup while the browser was at `/login`.
The test never reached its loading-state assertions. The file was identical
to base `63f14bba`; no editor runtime change was indicated by this failure.

Passive real-browser traces on both revisions show Sounding 0.2.0 returning
from `login.withPassword` while still at `/login` with the anonymous session
cookie. The real login redirect response arrives afterward. A preceding
precognition response is only validation, not authentication. Holding the real
login POST until the test attempts Bosun navigation reproduces the same
Migrate timeout at `/login` on both revisions. Waiting for the authenticated
home navigation restores the changed session cookie before Bosun returns 200;
all original loading-state assertions pass on both revisions under that probe.
The setup now waits for that home navigation, with no sleeps or timeout changes.

`login-readiness.json` preserves timing, session-change booleans and controlled
before/after results without credentials or cookie values. CI had no network
trace, so its exact historical request interleaving remains unconfirmed.
