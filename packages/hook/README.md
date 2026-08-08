# sails-hook-slipway

The Sails hook that connects an application to Slipway.

It currently provides:

- automatic request, exception, Waterline, Quest, and cache telemetry for
  Lookout;
- app-scoped boolean release flags with deterministic rollouts;
- app-owned Bearing feedback, roadmap, updates, and an optional widget; and
- a secure app-local `/bridge` entry point for people who manage application
  data without receiving Slipway infrastructure access.

## Installation

Requires Node.js 22 or newer.

```bash
npm install sails-hook-slipway
```

Slipway detects the hook and injects its deployment credentials automatically.
Do not copy Bridge or telemetry credentials into `config/slipway.js`.

## App-local Bridge

Enable Bridge for an app from **App → Bridge access** in Slipway, then redeploy
the app. Slipway injects a dedicated, app-scoped exchange credential into that
deployment.

People can enter Bridge through either URL without changing origin mid-session:

```text
https://your-app.example.com/bridge
https://slipway.example.com/projects/<project>/environments/<environment>/apps/<app>/bridge
```

The public URL keeps navigation, search, actions, and assets under the app's
own `/bridge` path. The Slipway URL is the operator entry point. If the app is
mounted below a route prefix, that prefix comes before `/bridge`; a root app
uses exactly `/bridge`.

The hook uses the app's existing authenticated user as the identity. Slipway
only activates an invitation when the signed-in user's verified email exactly
matches the invited email. The account may be created after the invitation is
sent, but it must exist and verify that address before Bridge opens. Bridge
users are not added to the Slipway team.

The default Boring Stack conventions work without app code:

- model: `User`
- session key: `userId`
- email: `email`
- name: `fullName`
- verification: `emailStatus` is `verified` or `confirmed`

Persist that provider-neutral verification state when Wish, a redeemed magic
link, or another authentication flow proves ownership of the exact email
stored on the user. A provider that verifies a different candidate email must
not confirm the current address. Opening `/bridge` must never call GitHub,
Google, or another identity provider, and Bridge does not need stored OAuth
access tokens.

### Declarative identity mapping

For conventional model-backed sessions with different names, map the
attributes instead:

```js
module.exports.slipway = {
  bridge: {
    loginPath: '/login',
    identity: {
      model: 'member',
      sessionKey: 'memberId',
      emailAttribute: 'emailAddress',
      nameAttribute: 'name',
      emailVerifiedAttribute: 'hasVerifiedEmail'
    }
  }
}
```

### Declarative host authorization

Bridge invitation roles are a ceiling. Narrow them with the host user's
persisted role without an application authorization helper:

```js
module.exports.slipway = {
  bridge: {
    authorization: {
      roleAttribute: 'role',
      roles: {
        admin: ['*'],
        editor: ['viewAny', 'view', 'create']
      },
      default: []
    },
    resources: {
      purchase: {
        authorization: {
          roles: {
            admin: ['viewAny', 'view'],
            editor: []
          }
        }
      }
    }
  }
}
```

Slipway resolves the host user by the stable ID established during the Bridge
exchange and reads the configured role once per authorization pass. Unknown
users, roles, actions, and invalid configuration fail closed.

### Direct domain actions

An action can invoke an explicitly allowlisted application domain helper with
validated fields as named inputs:

```js
issueLicense: {
  scope: 'resource',
  helper: {
    identity: 'license.createLicense',
    inputs: 'values',
    result: {
      message: 'License issued for {{email}}. Copy this key now: {{key}}'
    }
  },
  fields: {
    email: { type: 'email', required: true },
    maxUses: { type: 'number', required: true, min: 1, max: 2 }
  }
}
```

Sails still validates the domain helper's declared inputs. The result template
is rendered inside the target app and only the bounded message crosses into a
one-time Bridge flash. Add `context: ['actor', 'recordId']` only when the domain
helper explicitly declares those inputs. The browser can never choose a helper
identity.

### Custom authentication escape hatch

Use an identity helper only when authentication is not model-backed:

```js
// config/slipway.js
module.exports.slipway = {
  bridge: {
    loginPath: '/sign-in',
    identity: {
      helper: 'bridge.identity'
    }
  }
}
```

```js
// api/helpers/bridge/identity.js
module.exports = {
  friendlyName: 'Resolve Bridge identity',

  inputs: {
    req: { type: 'ref', required: true }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({ req }) {
    const member = await Member.findOne({ id: req.session.memberId })
    if (!member) return null

    return {
      id: member.id,
      email: member.email,
      fullName: member.name,
      emailVerified: member.emailVerified === true
    }
  }
}
```

The helper must return `emailVerified: true`. Bridge fails closed when it cannot
prove email verification.

## Bearing

Bearing gives each deployed app feedback, roadmap, and update pages on the
app's own domain. Enable it from **App → Bearing**, choose who may participate,
then redeploy once so Slipway can inject the app-scoped exchange credential.

```text
https://your-app.example.com/bearing/feedback
https://your-app.example.com/bearing/roadmap
https://your-app.example.com/bearing/updates
```

`/bearing` redirects to `/bearing/feedback`. Keeping every public surface below
the Bearing namespace prevents Slipway from claiming app routes such as
`/feedback`, `/roadmap`, or `/updates`.

When the widget is enabled, the hook adds one same-origin, asynchronous
bootstrap script to successful HTML responses. It does not edit the app's
templates, weaken its Content Security Policy, block a request on Slipway, or
render anything while the control plane says the widget is off. The capability
document is refreshed in the background with release flags.

The widget says **What's new** only when a published update is newer than the
last update that visitor opened. Opening it stores that update's public ID as a
local seen watermark. Its quiet lower-corner trigger opens a compact panel above
the same button; while open, that trigger becomes **Close**. Escape, an outside
click, or the panel's close control also dismisses it and returns focus. The
trigger then disappears until another update is published. No published or
unseen update means no injected UI is visible.

### One host identity contract

Bearing resolves the same verified host-app identity as Bridge, but creates a
customer participant—not a Slipway user or Bridge access grant. Configure the
identity mapping once at `slipway.identity`; either feature may still override
it for an unusual app. Existing `slipway.bridge.identity` configuration remains
the backward-compatible fallback.

```js
module.exports.slipway = {
  identity: {
    model: 'member',
    sessionKey: 'memberId',
    emailAttribute: 'emailAddress',
    nameAttribute: 'name',
    emailVerifiedAttribute: 'hasVerifiedEmail',
    loginPath: '/sign-in'
  }
}
```

For tenant-aware or external authentication, let the app compute the login URL
instead of teaching Slipway whether the route is `/login` or `/signin`:

```js
module.exports.slipway = {
  identity: {
    helper: 'slipway.identity',
    loginHelper: 'slipway.loginUrl'
  }
}
```

The login helper receives `req`, `returnUrl`, and `feature`, and returns a safe
local URL containing whatever redirect state the app needs. A static
`loginPath` remains the conventional fallback.

## Security model

- Bridge is disabled per app by default.
- The exchange credential is encrypted by Slipway, scoped to one app, kept
  server-side, and separate from the Lookout telemetry token.
- Enabling Bridge rotates the credential, so an old container cannot activate
  access before the required redeploy.
- Invitations expire after seven days, store only a SHA-256 token hash, and
  activate atomically against one host-app identity.
- Launch codes expire after two minutes and are consumed atomically once.
- The handoff regenerates the session before adding Bridge authorization.
- Disabling Bridge, revoking a grant, changing the app credential, or exceeding
  the eight-hour Bridge session lifetime invalidates access server-side.
- Bridge roles (`viewer`, `editor`, and `administrator`) are a ceiling. The
  target app's configured resource authorization can only narrow that access.
- Declarative host authorization loads the host user by its server-established
  ID, never by a client-supplied email.
- OAuth provider tokens stay inside authentication and are not required by
  Bridge.

## Lookout telemetry

Slipway automatically injects `SLIPWAY_TELEMETRY_URL` and
`SLIPWAY_TELEMETRY_TOKEN` during deployment.

Optional settings live under `lookout`:

```js
// config/slipway.js
module.exports.slipway = {
  lookout: {
    enabled: true,
    batchSize: 50,
    flushInterval: 10000,
    captureQueries: true,
    captureExceptions: true,
    captureQuestEvents: true,
    captureCache: true,
    slowQueryThreshold: 100
  }
}
```

Telemetry failures never break the host application.

## Release flags

Slipway injects the private flag endpoint and app identity during deployments
and rollbacks. Evaluate a flag with an explicit safe default:

```js
const enabled = await sails.helpers.flags.enabled.with({
  key: 'new-checkout',
  req: this.req,
  defaultValue: false
})
```

For a background job, pass a stable `context` containing a `user`, `account`,
`tenant`, or `team` identifier. Configuration is cached and refreshed in the
background; an unavailable control plane never fails or delays the host-app
request. `flags.enabled` is a regular Sails helper machine, so Sails validates
its declared inputs before evaluation. An app-defined helper at the same
identity is preserved. See the
[release flag guide](https://docs.sailscasts.com/slipway/release-flags) for
rollout behavior and Lookout comparisons.
