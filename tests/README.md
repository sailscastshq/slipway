# Test suite structure

Slipway keeps three test lanes:

- `tests/unit` for helpers, models, and isolated logic.
- `tests/functional` for fast Sounding request and Inertia page contracts using `get()`, `post()`, `visit()`, and `auth.request.*`.
- `tests/e2e/pages` for browser-backed Sounding trials only, using `{ browser: true }` when the DOM or navigation is the behavior under test.

When a test can be proven with request or Inertia helpers, it belongs in `functional`.
When the browser itself matters, it belongs in `e2e`.
Add a browser scenario to the existing test file for its owning page (for
example, a Bridge record action toast belongs in `projects/bridge-record.test.js`). Use a
separate file when it covers a distinct page or needs an independent,
expensive fixture; keep the browser shards balanced instead of growing one
page file without bound.
Do not add tests that merely inspect component source for imports, tags, or
class strings when a browser trial already checks the resulting behavior.
Keep unit tests for meaningful data transformations and decisions.

Run the complete Sounding 0.2 suite with `npm test`, or a single lane with
`npm run test:unit`, `npm run test:functional`, or `npm run test:e2e`.

CI runs unit and functional lanes alongside three isolated browser shards. All
browser files still run once: Sounding's `--shard=1/3`, `2/3`, and `3/3` divide
the file list, while each runner keeps `--test-concurrency=1` because fixtures
share ports and state. `Test (e2e)` succeeds only when all browser shards succeed.
Local `npm run test:e2e` still runs the whole suite.

Superseded PR and branch runs are cancelled; release verification uses its own
concurrency group. Test jobs print slow-trial profiles to guide future reductions.
Contract tests remain intact: recent timings show the serial browser suite was
the critical path, not the small storage, schema, or asset checks.
