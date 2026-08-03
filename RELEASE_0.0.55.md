# Slipway 0.0.55

Slipway 0.0.55 removes the remaining host-application Bridge adapters and
finishes the provider-neutral identity boundary started in 0.0.54.

## What was happening

Sailscasts had to compensate for three gaps in the Bridge contract:

1. `bridge.identity` loaded the signed-in user, read a stored GitHub access
   token, and called GitHub's `/user/emails` endpoint every time Bridge resolved
   identity.
2. `bridge.authorize` was invoked once for every enabled action. Each invocation
   then queried `User` again by actor email, so one Bridge authorization pass
   repeated the same user lookup many times in series.
3. `bridge.issueLicense` existed only to translate Bridge's internal
   `{ actor, resource, values }` envelope into the ordinary
   `license.createLicense` domain helper and format its one-time result.

The resident worker in 0.0.54 removed repeated Sails boot time, but these
request-time provider and adapter boundaries were still unnecessary latency and
application code.

## What changed

### Provider-neutral identity

Wish now resolves a verified private GitHub email during authentication.
Sailscasts persists `emailStatus: 'confirmed'` only when the provider verified
the exact address stored on the user. A different verified provider address
remains an email-change candidate and cannot confirm the current address.

The hook's conventional model/session identity resolver now opens Bridge with
one local user lookup. `/bridge` does not contact GitHub or Google and no OAuth
access token is stored for Bridge.

### Declarative host authorization

`sails.config.slipway.bridge.authorization` can map persisted host roles to
Bridge actions. Slipway resolves the host user by the stable ID bound during
the app-local exchange and loads that user once per authorization pass.
Per-resource role matrices can narrow the global policy; unknown users, roles,
actions, and invalid configuration fail closed. The invitation role remains an
independent ceiling.

For Sailscasts this replaces repeated `User.findOne({ email })` calls across
every enabled action with one `User.findOne({ id })` for the complete pass.

### Direct domain actions

A custom action may now allowlist an ordinary Sails domain helper, pass
validated action values as named inputs, and opt into only the actor/resource
context it declares. Structured scalar output can be mapped into a bounded
one-time message inside the target app. The browser cannot select a helper,
raw structured output is not persisted, and direct-helper exception text is
replaced with a generic failure.

Sailscasts points license issuance directly at `license.createLicense`. The
entire `api/helpers/bridge/` directory—identity, authorization, and action
adapter—is removed.

## URL behavior

The two 0.0.54 entry modes remain deliberate:

- public app flow: `https://<app-host>/bridge`, with navigation, search,
  actions, and assets staying on that origin;
- Slipway operator flow:
  `https://<slipway-host>/projects/<project>/environments/<environment>/apps/<app>/bridge`.

A root application such as Sailscasts uses exactly
`https://sailscasts.com/bridge`; Bridge never invents a resource-derived path
such as `/course/bridge`.

## Verification

- Slipway local: 272 unit, 98 functional, and 42 browser trials passed.
- Slipway GitHub CI: lint and the complete unit/functional/E2E job passed.
- The Bridge performance integration proves that an authorization pass with
  more than three enabled actions performs one host-role query.
- Sailscasts: 13 unit and 27 functional trials passed; lint passed; no E2E
  files are present.
- The Sailscasts PostgreSQL 16 migration was applied twice successfully and
  verified linked-account backfill, fail-closed unlinked accounts, constraints,
  and access-token removal.
- Public documentation passed Prettier and a VitePress production build.

After building the merged release locally, run:

```bash
bash ./local.sh rebuild
bash ./local.sh bridge-benchmark
```

The 0.0.54 latency gate remains in force: every warm Bridge runtime operation
must stay below 500 ms. The previous merged benchmark recorded 1, 1, 0, 0, and
0 ms of resident-runtime overhead after a one-time 4,760 ms worker start.
