const crypto = require('crypto')
const {
  isHostOriginRequest,
  normalizeRoutePath,
  publicBridgeBasePath,
  publicBridgeCallbackPath
} = require('../../lib/bridge-paths')

module.exports = {
  friendlyName: 'Launch Bridge',

  description:
    'Consume a host-issued launch code and establish a dedicated Bridge session.',

  inputs: {
    code: {
      type: 'string',
      required: true
    },
    hostOrigin: {
      type: 'boolean',
      defaultsTo: false
    },
    hostRoutePath: {
      type: 'string',
      defaultsTo: '/'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    forbidden: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ code, hostOrigin, hostRoutePath }) {
    const instanceUrl = await sails.helpers.getInstanceUrl()
    const useHostOrigin =
      hostOrigin && isHostOriginRequest(this.req, instanceUrl)
    const fallbackHostCallback = `${safeRoutePrefix(
      hostRoutePath
    )}/_slipway/bridge`
    const tokenHash = crypto.createHash('sha256').update(code).digest('hex')
    const launchCode = await sails.helpers.bridge.consumeLaunchCode(tokenHash)
    if (!launchCode) {
      throw {
        forbidden: useHostOrigin
          ? `${fallbackHostCallback}?error=bridge_link_expired`
          : '/login?error=bridge_link_expired'
      }
    }

    const access = await BridgeAccess.findOne({
      id: launchCode.access,
      app: launchCode.app,
      status: 'active'
    })
    const app = access
      ? await App.findOne({
          id: launchCode.app,
          bridgeEnabled: true
        }).decrypt()
      : null
    const environment = app
      ? await Environment.findOne({ id: app.environment })
      : null
    const project = environment
      ? await Project.findOne({ id: environment.project })
      : null

    if (!access || !app || !environment || !project) {
      throw {
        forbidden: useHostOrigin
          ? `${
              app ? publicBridgeCallbackPath(app) : fallbackHostCallback
            }?error=bridge_access_denied`
          : '/login?error=bridge_access_denied'
      }
    }

    const existingUserId = this.req.session.userId
    await regenerateSession(this.req)
    if (existingUserId) {
      this.req.session.userId = existingUserId
    }
    this.req.session.bridgeAccessId = access.id
    this.req.session.bridgeAppId = app.id
    this.req.session.bridgeAuthenticatedAt = Date.now()
    this.req.session.bridgeCredentialHash = hashCredential(app.bridgeSecret)
    this.req.session.bridgeHostOrigin = useHostOrigin

    if (useHostOrigin) {
      return publicBridgeBasePath(app)
    }

    return `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge`
  }
}

function safeRoutePrefix(value) {
  const prefix = normalizeRoutePath(value)
  return /^\/[A-Za-z0-9._~/-]*$/.test(prefix) ? prefix : ''
}

function regenerateSession(req) {
  if (typeof req.session.regenerate !== 'function') {
    // Sounding's virtual request transport exposes the session as a plain
    // object. Clear it in place so the trial still exercises the same
    // privilege-boundary behavior as a regenerated production session.
    for (const key of Object.keys(req.session)) {
      delete req.session[key]
    }
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error)
      return resolve()
    })
  })
}

function hashCredential(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
}
