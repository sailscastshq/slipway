# Wake: acquisition, activity, and revenue

Wake is optional, app-scoped product analytics for TBJS applications. It stays separate from Lookout and is off by default. It supports conventional Sails sessions, declared custom sessions, and anonymous sessionless apps. Custom containers do not gain analytics merely by being attached to Slipway.

## Install and enable

Install `sails-hook-slipway@0.0.10` or later in the app. Open the app's Wake → Settings, choose collection settings, save, and redeploy once. Normal deployment and rollback both receive app-scoped Wake credentials. The dashboard shows waiting for redeploy, update-required, disabled, or unavailable states instead of implying that an old hook collects data. Protocol 3 adds goals/revenue helpers and delivery diagnostics; protocol 2 collection remains compatible but requires an update for the full feature.

First-party mode, a consent gate, and respect for GPC/Do Not Track are the defaults. App HTTPS domains are allowed automatically; additional exact origins and excluded paths are explicit settings. Each save while enabled rotates the credential and requires redeployment. Disabling rejects new ingest immediately. Hosts refresh configuration every minute and fail closed after a two-minute lease. Neither ordinary page responses nor app startup wait for network ingestion.

See [collection and consent](wake-collection.md) for the browser API, manual same-origin script fallback, SPA navigation, CSP/streaming boundaries, identity mapping, and privacy controls. No email/name is collected. Country remains **Unknown** until a trusted enrichment integration is provided; raw IP is not retained. Analytics identifiers are not authentication cookies or a claim of consent compliance.

For Hagfish, declare the actual identity model referenced by `creatorId` in `slipway.identity`; the model is not guessed. Pailore can remain anonymous and sessionless without a User model or a login session. A server-verified identity helper can optionally identify an already authenticated principal.

## Goals

Browser goals are interaction signals. Server goals are explicitly emitted business events:

```js
await sails.helpers.wake.track.with({
  req: this.req,
  name: 'signup',
  eventId: `signup_${record.id}`, // stable, 8–128 safe identifier characters
  properties: { plan: 'pro' }
})
```

Call this after successful signup; Wake does not infer signup from record creation. Emit a business event once from the authoritative server rather than also calling the browser goal with the same meaning. Provenance remains visible in Overview and Journeys. Properties allow at most ten bounded scalar values; sensitive field names are rejected. Do not put personal information into otherwise innocuous property values.

Goals use the bounded best-effort analytics queue. `{ accepted: true }` means queued, not durable delivery. In consent-gated first-party mode a permitted analytics cookie must already exist. A missing/invalid cookie or privacy/support-session exclusion suppresses the goal. In cookieless mode, server goals can be emitted only when the server's configured collection policy does not require a browser consent proof; browser goals continue to honor their consent gate. Do not weaken an app's privacy choice merely to emit server goals.

## Checkout attribution and committed revenue

At checkout creation, obtain an opaque attribution token from the existing permitted analytics cookie:

```js
const attributionId = await sails.helpers.wake.attribution.with({
  req: this.req
})
// Put attributionId in the payment provider's checkout metadata, for example
// customData.slipwayWake when using your sails-pay checkout integration.
```

This works without an application login. The token is encrypted/authenticated, scoped to one app, valid for thirty days, and exposes no visitor ID. Missing, expired, tampered, or credential-rotation-invalidated attribution produces an **unattributed** payment; it does not discard valid revenue. Cookieless mode issues no persistent attribution token.

After verified payment processing, the app's durable payment record/job delivers analytics:

```js
const receipt = await sails.helpers.wake.revenue.with({
  transactionId: String(payment.id),
  amount: payment.amountInMinorUnits,
  currency: payment.currency.toUpperCase(),
  occurredAt: payment.paidAt, // original payment timestamp, milliseconds
  attributionId: payment.customData.slipwayWake || undefined
})
// Persist receipt/analytics-delivered state in the app's durable job or record.
```

`occurredAt` is required and must remain unchanged on replay. Amounts are nonnegative safe integers up to 1,000,000,000,000 in the currency's minor unit; supported ISO currency codes are validated. A receipt is returned only after SQLite commits with FULL synchronous durability. An identical replay returns `{ receipt, duplicate: true }`. Conflicting amount/currency/time or transaction identity under the same key returns HTTP 409; it never overwrites a payment.

Revenue bypasses the disposable pageview queue. A timeout, 429, 503, network error, or revoked credential does not acknowledge a receipt. Retry the **same transaction ID, original timestamp, amount, and currency** from the app-owned durable source, with bounded backoff. Reconcile unacknowledged payments periodically. Treat validation/conflict failures as permanent until corrected; inspect the original helper error's status/retriable fields (Sails may wrap it in `raw`). Keep analytics out of the customer checkout response path, and never reverse a successful payment because Wake is unavailable. No payment provider is monkey-patched.

Refunds use a separate idempotent adjustment key:

```js
await sails.helpers.wake.revenue.with({
  transactionId: String(payment.id),
  adjustmentId: String(refund.id),
  amount: refund.amountInMinorUnits,
  currency: payment.currency.toUpperCase(),
  occurredAt: refund.refundedAt
})
```

The original receipt must exist. Currency must match, refund time cannot precede payment, and cumulative refunds cannot exceed the payment. Gross, refunds, and net remain separate. Different currencies are never summed or converted. Retrying an adjustment uses its same original timestamp.

The fixed reporting/receipt window is 396 days (thirteen months for this release). Events older than that window, or over five minutes in the future, are rejected. Old receipts are pruned; an old payment replay cannot become a new payment after pruning because its original timestamp is outside acceptance. Refunds against a pruned original receipt are rejected. This is analytics retention, not an accounting ledger.

## Reporting definitions

Dates, selected currency, tabs, and visitor selection belong to the URL. Dates use UTC days, inclusive From/Through controls, and an exclusive next-day bound internally. Any active team member can read their app's analytics; only owners/admins can change settings or delete visitor history. Bridge-only invited users cannot access Wake.

- **Visitors:** distinct permitted visitor IDs active in the range. Exact daily membership is retained; daily unique totals are never added together.
- **Sessions:** sessions beginning in the range. The browser identity contract uses a thirty-minute inactivity timeout.
- **Signup conversion:** visitors active in the range with a server signup in that same range, divided by the range's distinct visitors. Browser signup signals do not count as authoritative signups.
- **Goals:** event counts and distinct converting visitors, separated by browser/server provenance.
- **Revenue:** committed payments/refunds whose occurrence falls in the range, filtered to one currency. Unattributed net remains included and is also shown separately.
- **Paying visitors:** distinct attributed visitors with a payment in the range. This cannot count unattributed customers or deduplicate across devices.
- **Revenue per visitor:** net revenue in the range attributed to its active visitor cohort divided by that cohort's visitors, in one currency.
- **Sources/campaigns:** event-touch dimensions, labeled as such. First/last touch and first landing pages are separately preserved. No multi-touch attribution model is implied.

Cookieless mode reports event and revenue totals, with persistent visitors/conversion/journeys unavailable. Journeys use anonymous IDs, list the latest fifty matching visitors, and bound selected timelines to two hundred raw events and two hundred receipts. Raw timelines stop after thirty days. Historical event counts, exact retained membership, and receipts remain available within the reporting window. Currency totals beyond JavaScript's safe integer range are refused rather than rounded silently.

## Storage, maintenance, and deletion

Wake uses `db/analytics.db` in Slipway's persistent database volume. It does not use Lookout's database, token, or failure budget. Ingest atomically commits raw events, daily totals, visitor membership, sessions, and first/last touches. Retries cannot double-count. Late accepted events update their original UTC partition. Existing foundation rows backfill in batches of 1,000; the UI flags incomplete backfill.

A non-overlapping Quest job runs every five minutes. It removes at most 5,000 rows per table per pass: raw events after thirty full UTC days, aggregates/membership/visitors/sessions/receipts after 396 days, and expired deletion suppression records. Raw rows are pruned only once reporting records committed. Busy systems may temporarily retain extra expired rows while bounded pruning catches up. Sessions/visitor metadata and diagnostics have retention bounds too.

Authorized visitor deletion removes raw events, membership, sessions, and touch history and detaches receipt attribution. Anonymous aggregate event totals and financial receipts remain. A hashed suppression identifier lasts ninety days to reject pending events for the deleted visitor; it carries no journey or identity details. Disabling is not deletion. App/environment/project cleanup removes all their Wake tables before marking cleanup complete; unavailable storage leaves cleanup retryable. Maintenance also removes orphaned app data.

Storage size is explicitly **host-wide**, not a per-app estimate. Settings show received/duplicate/rejected/dropped events, failed delivery, oldest raw activity, and last maintenance. Runtime counters are transmitted at the next successful registration; an abruptly lost process cannot report counters it never sent. SQLite FULL errors or unavailable storage return a retriable failure without acknowledging revenue; raw events and reporting updates roll back together. An unopenable/corrupt analytics file is left intact and the optional datastore is disabled so the primary app can still start. Repair the volume/database and restart to resume. No fallback memory database accepts analytics.

### Backup and restore

Keep `db/analytics.db` on persistent storage along with the main database. Treat analytics backups separately from application/service database backups. Use SQLite's online backup API or stop Slipway and copy a consistent database including outstanding WAL state; copying a live `.db` alone is not a safe backup. For example, on the Slipway host using its installed dependency:

```js
const Database = require('better-sqlite3')
const db = new Database('./db/analytics.db', { readonly: true })
await db.backup('/your/persistent/backups/analytics.db')
db.close()
```

Test restoration into an isolated instance. Stop Slipway before replacing its database, preserve the old file/WAL for recovery, and restore the matching main database when app IDs have changed. An analytics backup predating an acknowledged payment can lose that receipt; reconcile/replay from the app-owned payment source within the acceptance window. Reapply deletion requests after restoring an older backup. Storage or analytics failure never changes the authoritative payment outcome.
