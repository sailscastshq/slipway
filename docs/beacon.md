# Beacon

Beacon is Slipway's proposed public URL uptime feature ([#905](https://github.com/sailscastshq/slipway/issues/905)). Lookout reports infrastructure and application telemetry; Beacon asks whether the public site can be reached through DNS, TLS and the proxy.

## Intended experience

Enable Beacon for an app's public URL. An independent checker observes it every minute, with a ten-second total deadline. Show Up, Down or Unknown, response-header latency, last success, incident history and the active deployment at the time of an incident. Two consecutive failures open an incident; two consecutive successes resolve it. Team notifications follow confirmed transitions. Public status pages come later.

Three minutes without a fresh observation means Unknown. Missing observations are never credited as uptime. A single failure while Up remains pending confirmation; the eventual UI must show the latest observation as well as the confirmed state. After a gap, confirmation starts again, while any unresolved incident remains open.

## Implemented foundation

The dependency-free probe and availability reducer live in `api/lib/beacon/`. A one-shot command can run on a separate machine with Node 22.20+:

```sh
node tools/beacon-check.cjs https://your-public-site.example/health
```

The command prints one JSON observation with `checkedAt` (Unix milliseconds at check start), `durationMs` (through response headers), `outcome`, `reason` and, when available, `statusCode`. Exit codes: 0 for Up, 1 for Down, 2 for rejected/Unknown configuration. Only 2xx responses count as success. Redirects are returned as a failure with their HTTP status; they are not followed. Use the final public URL for now. The response body is not read, so this tests reachability and HTTP status rather than application correctness or full page load time.

Only default HTTP/HTTPS ports are accepted. Credentials are rejected. Every returned DNS address must be public; mixed public/private results are rejected. The selected address is pinned into the connection while preserving the original hostname for HTTP Host and HTTPS certificate validation. Private, loopback, link-local, metadata, reserved/documentation and IPv6 transition destinations are excluded conservatively. DNS resolution is cancelled at the total deadline, headers are bounded to 16 KiB, and bodies are discarded. Invalid targets and network errors do not echo URL credentials or query strings.

`availability.observe()` consumes strictly ordered observations, ignores duplicate/older timestamps, and returns state plus an optional incident event. It has no persistence or notification side effects. `availability.statusAt()` applies freshness at read time. Configuration rejection is Unknown, not proof of a site outage. This reducer is trusted internal logic, not an authenticated ingestion boundary; a future receiver must verify checker identity, clock skew, monitor scope and replay protection before calling it.

## Dashboard and public status page

The app dashboard is available from the app actions menu at `.../apps/:appSlug/beacon`. Its real state is Unknown: no independent checker is connected and no measurements or incident history are invented. The app URL and current deployment come from the authorized app context. Team, project, environment and app access are checked server-side; Bridge sessions cannot access this surface.

Choose **Explore example** to inspect explicitly simulated recovered, outage and missing-checker scenarios. Example observations use the actual availability reducer but are never stored or sent to a site. The sample target is always `https://example.com/health`; sample deployment context is labeled separately. The timeline, response chart (with gaps), recent observations and expandable incidents demonstrate the dashboard. Returning to the app removes the sample data. Both desktop and mobile use the real Vue/Inertia page.

Like Bridge and Bearing, Beacon also has an app-owned public product surface. Once enabled by a team owner or administrator and activated by an app redeploy, the route is **`/beacon` on the deployed app's domain**, or `/academy/beacon` for an app mounted at `/academy`. The domain is resolved from the app's actual configuration; `example.com` is illustrative, not hard-coded. The authenticated dashboard and public page are separate.

The public page is off by default. Its dashboard setting explains that enabling publishes the app's display name and Unknown status. It uses the shared app appearance, with its own namespace for styles, logos and assets. Caddy forwards only the exact `/beacon` path and descendants to an anonymous renderer; unrelated paths such as `/beaconish` still reach the app. Both JSON routes and Docker Caddy labels follow this convention. Workers, reserved mounts, health-path collisions and conflicting sibling app mounts cannot enable the page. Disabling immediately makes the renderer, stylesheet and logo unavailable; redeploy to remove the old ingress route. App deletion cleans up its public-page setting.

Until monitoring exists, the public page always shows Unknown, no last check/success and unavailable incident history. It does not expose dashboard examples, deployment identifiers, team/environment context or checker configuration. Example query parameters do not change its status. The page shares the app host's ingress and Slipway control plane, so it is not an independently hosted outage status page.

## Remaining work

This slice has no scheduled checker, stored monitors/history, result ingestion, alert delivery, uptime percentage or live deployment correlation. Running the command on the monitored server does not provide independent uptime coverage.

The next slice needs team-scoped monitor configuration, authenticated result ingestion, bounded storage, explicit checker heartbeat, and a separately operated scheduler. Decide the independent host and ownership before enabling live coverage. No production configuration or credentials are installed by this work. Reuse Slipway's team notification preferences only after durable incident and delivery deduplication are in place.

## Logo and colour modes

Use **Edit app logo and colour mode** in Beacon's public-page settings to open the existing shared **App appearance** editor. These are the same settings used by Bridge and Bearing, not a separate Beacon logo store. Upload a light logo (PNG, JPEG or WebP, up to 256 KB) and optionally a dark variant. Managed still WebP images are served through Beacon's namespaced logo routes. The visible app name remains alongside the logo and supplies a readable fallback when logos are absent or fail to load.

**Follow system** updates with the visitor's system light/dark preference. **Always light** and **Always dark** override that preference. **Follow app** uses the existing host-mode integration when embedded; on the standalone public page it uses the configured fallback (system, light or dark). Beacon does not add an independent visitor theme preference or override the app owner's setting.

The selected mode chooses the matching logo. With only a light logo, it remains visible on a white backing in dark mode. If that image fails but the dark variant works, the dark variant remains available on a dark backing; if both fail, the app name stays visible. Default branding now also uses the shared validated semantic palettes before customization, including the first page load, so its muted text remains legible in either mode.

## Validation

```sh
node --test tests/unit/lib/beacon.test.js
npx sounding test --file tests/functional/pages/beacon.test.js
npx sounding test --file tests/e2e/pages/projects/beacon.test.js
npx sounding test --file tests/functional/pages/beacon-public.test.js
npx sounding test --file tests/unit/helpers/caddy/beacon.test.js
npx sounding test --file tests/e2e/pages/projects/beacon-public.test.js
npx sounding test --file tests/e2e/pages/projects/beacon-branding.test.js
```

Trials cover public-address restrictions, URL normalization, mixed DNS, connection pinning, redirect refusal, deadlines, real local HTTP fixtures, confirmation/recovery, missing observations and CLI redaction. They make no requests to production sites.

Dashboard trials check authentication and team/hierarchy isolation, real empty state versus explicit examples, app-menu navigation, example transitions, incident disclosure, returning to actual coverage, and mobile horizontal overflow. The browser trial captures actual local preview screenshots under `.tmp/screenshots/beacon/`.

Public-page trials cover opt-in publishing with real CSRF-protected owner/member sessions, namespace collisions, disabled/worker/hierarchy guards, redacted public props and cleanup. The public browser trial uses production-generated JSON routes through a disposable real Caddy process, replacing only Docker upstream names and the hostname with loopback fixtures. It proves guest loading, assets, refresh, return navigation, `/beaconish` pass-through, immediate disable and root/prefixed mobile layouts. This optional trial requires `caddy` on PATH (or `SLIPWAY_CADDY_BINARY`), otherwise it is explicitly skipped. Docker-label contracts remain covered without Caddy.

The branding browser trial uploads both logo variants through the actual shared editor and checks Beacon anonymously through a prefixed Caddy origin: system changes, fixed modes, standalone host fallback, loaded logo variants, one-logo backing, image failures, no-logo name fallback, mobile overflow and default/body-text contrast of at least 4.5:1. Screenshots use isolated example branding, not production data.
