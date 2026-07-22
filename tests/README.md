# Test suite structure

Slipway keeps three test lanes:

- `tests/unit` for helpers, models, and isolated logic.
- `tests/functional` for fast Sounding request and Inertia page contracts using `get()`, `post()`, `visit()`, and `auth.request.*`.
- `tests/e2e/pages` for browser-backed Sounding trials only, using `{ browser: true }` when the DOM or navigation is the behavior under test.

When a test can be proven with request or Inertia helpers, it belongs in `functional`.
When the browser itself matters, it belongs in `e2e`.

Run the complete Sounding 0.2 suite with `npm test`, or a single lane with
`npm run test:unit`, `npm run test:functional`, or `npm run test:e2e`.
