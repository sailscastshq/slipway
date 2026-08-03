# Slipway 0.0.54

Slipway 0.0.54 makes Bridge a resident application runtime instead of paying
the cost of booting the target Sails application for every page operation. It
also keeps app-local Bridge browsing on the host application's `/bridge` URL.

## Bridge performance

### What was happening

Every Bridge operation started `docker exec ... node`, loaded the deployed
Sails application, ran one operation, lowered Sails, and exited. A Bridge page
can perform introspection, authorization, dashboard, count, and record queries.
Search repeated the same pipeline after its 300 ms debounce. Overlapping
searches therefore created multiple temporary Sails processes, so later
navigation appeared to stop responding while earlier work completed.

### What changed

- One production-mode Bridge worker is reused for each live app container.
- Bridge-enabled apps are prewarmed after deploy and rollback and when Slipway
  starts, keeping Sails bootstrap work outside normal Bridge requests.
- A timeout or stopped container discards the worker so the next operation can
  recover with a new one.
- Record searches use an Inertia partial reload and do not repeat unchanged
  dashboard work.
- A new `local.sh bridge-benchmark` command compares the old lifecycle with
  the resident runtime and fails when any warm operation reaches 500 ms.

The resident worker intentionally remains separate from the application's web
process. This preserves the existing execution boundary, so an expensive or
failed Bridge operation cannot block the public application's event loop.

## Same-origin Bridge

### What was happening

The host app's `/bridge` hook authenticated the app user, exchanged that
identity for a one-time launch code, and then redirected the browser to the
Slipway control-plane hostname. Every Bridge link was consequently built as a
Slipway dashboard path. That produced two different browsing models and made a
host-app launch unexpectedly leave the host origin.

A simple reverse proxy alone would not be safe for two Sails applications:
both default to a cookie named `sails.sid`, so the proxied Slipway session could
overwrite the host application's session on the same origin. Absolute asset,
API, redirect, and Inertia page URLs would also escape the proxy after the
first page.

### What changed

- Caddy gives each Bridge-enabled app three routes before the app catch-all:
  the one-time launch endpoint, a namespaced asset endpoint, and the app's
  `/bridge` subtree.
- The host app authenticates through a private `/_slipway/bridge` callback;
  direct `/bridge` exchange remains available for deployments without the new
  ingress route.
- Host-origin exchange returns a launch URL on the app's public hostname and
  sets the same revocable, app-scoped Bridge session used by direct Slipway
  access.
- Slipway sessions now use `slipway.sid`, keeping them separate from a host
  Sails app's `sails.sid` while retaining normal session-backed CSRF.
- Server redirects, relationship APIs, Inertia page URLs, initial assets, and
  lazy-loaded chunks use the public Bridge base path. Direct
  `slipway.sailscasts.com/projects/.../bridge` navigation is unchanged.
- The Bridge Access screen and app menu expose both entry points explicitly:
  the public `https://<app-host>/bridge` URL and the operator
  `https://<slipway-host>/projects/<project>/environments/<environment>/apps/<app>/bridge`
  URL.

Changing the Slipway session cookie name requires operators to sign in to the
Slipway dashboard once after upgrading. Host-app sessions are not affected.

## Configuration correctness

### What was happening

Legacy service-managed variables could have values without stored metadata.
The configuration page resolved the missing fields into the correct effective
policy, but an update compared that effective request with the raw legacy
record. Adding an unrelated variable could therefore look like an attempt to
change a protected managed variable and be rejected.

The same normalizer was also used while reading environment and app pages. It
treated missing default fields as a mutation and stamped the parent record's
`updatedAt` onto each variable. The UI could then claim a legacy secret had
changed “N minutes ago” even when the timestamp belonged to an unrelated
environment or app update.

### What changed

- Managed-variable guards compare effective current policy with effective
  requested policy. Actual managed values and policies remain protected.
- Read-only normalization is explicit and never creates actor/time history;
  environment, app, and global configuration pages now use the same path.
- Only an accepted value or policy mutation records who changed a variable and
  when. Unrelated environment edits leave variable history byte-for-byte
  unchanged.
- Variable rows show only `Managed secret`, `Secret`, or `Plain config` plus
  genuine history. Preview behavior is explained in the existing variable
  menu instead of repeated in every row.
- Row actions remain visually quiet but are keyboard-focusable, and the menu
  opens with Enter. The policy explanation was verified in light, dark, and
  390 px-wide layouts.

### Local measurements

On August 3, 2026, the reproducible local Docker benchmark recorded:

| Measurement                         | Result                |
| ----------------------------------- | --------------------- |
| Old per-operation lifecycle         | 4,936 ms and 4,760 ms |
| One-time deployment/startup prewarm | 4,760 ms              |
| Five consecutive warm operations    | 1, 1, 0, 0, and 0 ms  |
| Slowest warm runtime operation      | 1 ms                  |
| Local Slipway login TTFB            | 26 ms                 |

These numbers isolate Bridge runtime overhead. Database execution, network
latency, the 300 ms search debounce, and browser rendering remain part of the
complete user-visible latency.

### Verification

Start the local Docker stack and run the latency assertion:

```bash
bash ./local.sh
bash ./local.sh bridge-benchmark
```

Then run the regression lanes:

```bash
npm run test:unit
npm run test:functional
```

The 0.0.54 release gate is:

- no target Sails bootstrap during warm navigation or search;
- every warm runtime operation below 500 ms;
- a table-only search does not re-run dashboard queries;
- worker timeout is bounded and the next operation starts a clean worker;
- first visible Bridge page below two seconds in the production smoke test;
- subsequent navigation below 500 ms in the production smoke test; and
- search results begin rendering within 800 ms after the final keystroke.

The same-origin gate additionally requires:

- an app-origin `/bridge` request never changes the browser hostname;
- a non-root app keeps launch, assets, navigation, search, API calls, and
  mutation redirects under its own `<app-path>/bridge` prefix;
- host and Slipway session cookies cannot overwrite each other;
- revocation and Bridge-secret rotation invalidate both URL modes; and
- Caddy accepts the generated ordered handlers before deployment cutover.

The final merged candidate passed 270 unit, 98 functional, and 42 browser tests
locally. Both environment-fix pull requests also passed the complete GitHub CI
pipeline independently.
