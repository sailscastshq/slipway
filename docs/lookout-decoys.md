# Lookout Decoys

Lookout Decoys is off by default for every app. A team owner or admin can opt an
app into a small fixed set of verified-unused paths in **App settings → Lookout
Decoys**. The settings show the exact effective paths under the app mount. The
owner must acknowledge that these paths are unused; Slipway cannot discover an
app's dynamic routes. Disable decoys before changing the app mount, then verify
the new paths before enabling again.

Selected GET/HEAD requests receive a fixed 21-byte inert JSON response with HTTP
200, JSON content type, `no-store`, and `nosniff`. Other paths and methods retain
their ordinary behavior. No credentials, callbacks, client IPs, headers, query
strings or bodies enter the observation store. The feature does not rate-limit
incoming traffic and a hit does not establish that a visitor was malicious.

**Lookout → Decoys** groups sampled observations by app, path, method and actual
HTTP status in the last hour. App/path filters survive refresh. It works without
an app telemetry hook. These observations use `lookout.decoy_hit` metrics and never
enter HTTP spans, success/error totals, latency or flag comparisons. App telemetry
cannot supply the reserved `lookout.*` namespace. The view is capped at the latest
1,000 observations and existing telemetry retention removes them after seven
days.

## Ingress and storage contract

Configuration is an app-keyed record (`lookout.decoys.app:<id>`) in the existing
settings store, not an environment variable or resource limit. Deployed changes
use the verified candidate-route transaction; verification checks handler
revisions as well as upstreams, and failed application restores the prior stored
configuration and route. Undeployed apps are shown as configured for their first
deployment. Known health, system and sibling-mount conflicts fail validation,
including undeployed sibling apps. Unknown dynamic routes still require the
owner's acknowledgement.

Caddy handles the exact allowlisted paths and writes only marked decoy access
records to an environment-specific file in its existing `/data` volume. Logging
is skipped by default; exact decoy handlers opt back in. Request and response
header objects are deleted before encoding. Logs rotate at 2 MiB with two
archives; core sampling keeps the first five observations per default interval
and then every hundredth. These are observation/storage limits, not traffic
limits. No proxy image, plugin, listener, socket access or mount is added.

The supported proxy image is distroless. Lookout uses the existing Docker access
to read the file via `docker cp` rather than installing a shell or utilities.
Each read has a five-second timeout and a 2 MiB plus 64 KiB archive-output limit.
Only the last 256 KiB and 1,000 lines are parsed. The existing five-minute cycle
rotates across at most four environments and admits at most 200 observations,
with a 50-per-app cap. Busy installations can take longer than five minutes.
Oversized, malformed, foreign, future, stale-revision and repeated records are
ignored. Only explicit allowlisted fields are stored; raw log objects are never
persisted. Missing/unavailable files do not block app-log collection.

The disposable proxy contract exercises both the installer image and the pinned
image used by existing ingress contracts. It checks real responses, normal
routes, app prefixes, Bridge preservation, filtering, collection, replay
deduplication and candidate cutover. Activation remains an explicit operator
choice after review; existing apps stay off.
