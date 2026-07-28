# sails-hook-slipway

The Sails hook that connects an application to Slipway.

It currently provides:

- automatic request, exception, Waterline, Quest, and cache telemetry for
  Lookout; and
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

People open:

```text
https://your-app.example.com/bridge
```

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

### Custom authentication

Configure one identity helper when the app uses different authentication
conventions:

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
