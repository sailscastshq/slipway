# Wake foundation (issue #499)

This is the first implementation phase of Wake. It is not a released analytics feature. There is no user-facing enablement switch, collector, payment helper, or dashboard yet. The parent issue stays open.

## Implemented boundary

- App fields default to disabled; the private credential is encrypted and protected. Internal enablement requires a team owner/admin and records an audit event. Disablement removes the credential; enabling issues a new credential.
- Normal deployment and rollback use the same Wake configuration helper. Disabled apps overwrite reserved Wake variables with disabled/empty values.
- Analytics tables live in `db/analytics.db`, independently of Lookout. Explicit schema preparation is repeat-safe, and analytics schema failure is reported without aborting the rest of bootstrap. A failure opening a configured datastore during ORM initialization remains a Sails startup limitation to resolve before general availability.
- JSON-only runtime endpoints authenticate an exact Bearer credential against the enabled app and verify deployment ownership. These are server-to-server endpoints, not browser collection routes.
- Ingest accepts up to 100 pageview/goal events and 64 KiB per request. Each app gets 120 requests, 3,000 events, and 2 MiB per minute. Budget reservations and event uniqueness are enforced in SQLite. Requests count against the budget even if events are duplicate deliveries.
- Event times must be within the last 30 days and no more than five minutes ahead. Paths lose query strings/fragments. Unknown fields, personal-identity payloads, arbitrary properties, and revenue are rejected in this phase.
- Registration reports `collectionReady: false` and `leaseMs: 0`. The bundled hook registers separately from Lookout with a three-second deadline and one-minute heartbeat, stops on revocation, and never blocks app startup waiting for the server.

## TBJS identity

The minimal Wake resolver supports `User`/`session.userId`, a declared custom model/session key such as Hagfish's `creatorId`, or a custom helper returning a verified `{ id }` or `null`. Pailore can remain sessionless: absence of a session does not require a User model or create a login session.

Wake-specific mapping overrides shared mapping, with legacy Bridge mapping retained for compatibility. Helpers returning null never fall through to a session identity. Email/name/verification data are not returned. Resolver failures become anonymous with bounded, sanitized diagnostics. Bridge/Bearing's existing verified-email contract is unchanged.

The resolver is server-side infrastructure, not yet wired to a collector. Collection must invoke it after host authentication middleware in the next phase. Anonymous visitor tokens and logout/account-switch behavior are also collection-phase work.

## Remaining before general availability

Automatic/fallback injection, browser-origin and consent handling, visitor/session identifiers, identity joining, allowed origins, privacy settings, bounded retention/deletion, backup/recovery, authoritative goals, revenue receipts/replay, accurate rollups, dashboard, and release/capability documentation remain under #499. Do not enable this foundation on production apps as a substitute for those phases.

The hook package version is not bumped or published in this phase. Registration advertises only protocol groundwork, not completed collection support. The first Wake-capable published version must be recorded at release.

## Verification

Sounding trials cover real HTTP ingest and hook registration, concurrent deduplication and limits, body bounds, scoped credentials and revocation, encrypted secret rotation, repeat-safe schema preparation, default/custom/sessionless identity, and existing Bridge behavior. Existing CI also exercises deployment and browser regressions. No visual UI changed in this phase.
