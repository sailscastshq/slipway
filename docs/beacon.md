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

## Remaining work

This slice has no scheduled checker, dashboard integration, stored monitors/history, result ingestion, alert delivery, uptime percentage or deployment correlation. Running the command on the monitored server does not provide independent uptime coverage.

The next slice needs team-scoped monitor configuration, authenticated result ingestion, bounded storage, explicit checker heartbeat, and a separately operated scheduler. Decide the independent host and ownership before enabling live coverage. No production configuration or credentials are installed by this work. Reuse Slipway's team notification preferences only after durable incident and delivery deduplication are in place.

## Validation

```sh
node --test tests/unit/lib/beacon.test.js
```

Trials cover public-address restrictions, URL normalization, mixed DNS, connection pinning, redirect refusal, deadlines, real local HTTP fixtures, confirmation/recovery, missing observations and CLI redaction. They make no requests to production sites.
