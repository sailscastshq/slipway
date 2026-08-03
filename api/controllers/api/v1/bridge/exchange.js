const crypto = require('crypto')

module.exports = {
  friendlyName: 'Exchange host Bridge identity',

  description:
    'Exchange an authenticated host-app user for a short-lived Bridge launch URL.',

  inputs: {
    appId: {
      type: 'string',
      required: true
    },
    hostUser: {
      type: 'json',
      required: true
    },
    inviteToken: {
      type: 'string'
    },
    hostOrigin: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: {
      statusCode: 201
    },
    badRequest: {
      statusCode: 400
    },
    unauthorized: {
      statusCode: 401
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ appId, hostUser, inviteToken, hostOrigin }) {
    const presentedSecret = bearerToken(this.req)
    const app = await App.findOne({ id: appId }).decrypt()

    if (
      !app ||
      !app.bridgeEnabled ||
      !app.bridgeSecret ||
      !safeEqual(presentedSecret, app.bridgeSecret)
    ) {
      throw 'unauthorized'
    }

    const email = normalizeEmail(hostUser?.email)
    const hostUserId = normalizeIdentifier(hostUser?.id)
    const fullName = normalizeName(hostUser?.fullName)

    if (!email || !hostUserId || hostUser?.emailVerified !== true) {
      throw {
        badRequest: {
          error:
            'Bridge requires an authenticated host-app user with a verified email address.'
        }
      }
    }

    const access = await BridgeAccess.findOne({
      app: app.id,
      email
    })

    if (!access || access.status === 'revoked') {
      throw 'forbidden'
    }

    if (
      access.status === 'active' &&
      String(access.hostUserId) !== hostUserId
    ) {
      sails.log.warn(
        `Bridge identity mismatch for ${email} on app ${app.id}; denying exchange.`
      )
      throw 'forbidden'
    }

    let currentAccess = access
    let activated = false
    if (access.status === 'pending') {
      currentAccess = inviteToken
        ? await sails.helpers.bridge.activateInvitation.with({
            accessId: access.id,
            inviteToken,
            hostUserId,
            hostUserName: fullName
          })
        : null

      // Duplicate requests from the identity that just activated the
      // invitation are harmless. A competing identity must never win.
      if (!currentAccess) {
        const racedAccess = await BridgeAccess.findOne({ id: access.id })
        if (
          !racedAccess ||
          racedAccess.status !== 'active' ||
          String(racedAccess.hostUserId) !== hostUserId
        ) {
          throw 'forbidden'
        }
        currentAccess = racedAccess
      } else {
        activated = true
      }
    } else {
      currentAccess = await BridgeAccess.updateOne({
        id: access.id,
        status: 'active',
        hostUserId
      }).set({
        hostUserName: fullName,
        lastUsedAt: Date.now()
      })
      if (!currentAccess) throw 'forbidden'
    }

    const code = await sails.helpers.bridge.issueLaunchCode.with({
      accessId: currentAccess.id,
      appId: app.id
    })
    const instanceUrl = await sails.helpers.getInstanceUrl()
    let launchBaseUrl = instanceUrl.replace(/\/$/, '')

    if (hostOrigin) {
      const environment = await Environment.findOne({ id: app.environment })
      const project = environment
        ? await Project.findOne({ id: environment.project })
        : null
      const appUrl =
        environment && project
          ? await sails.helpers.bridge.getAppUrl.with({
              app,
              environment,
              project
            })
          : ''

      if (!appUrl) {
        throw {
          badRequest: {
            error: 'Bridge does not have a public app URL for this deployment.'
          }
        }
      }
      launchBaseUrl = appUrl.replace(/\/$/, '')
    }

    await sails.helpers.audit.log.with({
      action: activated ? 'bridge.access.activated' : 'bridge.access.exchanged',
      resourceType: 'app',
      resourceId: String(app.id),
      teamId: String(access.team),
      ipAddress: this.req.ip,
      details: {
        email,
        role: currentAccess.role,
        hostUserId
      }
    })

    return {
      launchUrl: `${launchBaseUrl}/bridge/launch?code=${encodeURIComponent(
        code
      )}${
        hostOrigin
          ? `&hostOrigin=true&hostRoutePath=${encodeURIComponent(
              app.routePath || '/'
            )}`
          : ''
      }`
    }
  }
}

function bearerToken(req) {
  const value = req.get('authorization') || ''
  return value.startsWith('Bearer ') ? value.slice(7) : ''
}

function safeEqual(left, right) {
  if (!left || !right) return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function normalizeEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function normalizeIdentifier(value) {
  if (value === undefined || value === null) return null
  const identifier = String(value).trim()
  return identifier && identifier.length <= 255 ? identifier : null
}

function normalizeName(value) {
  const name = String(value || '').trim()
  return name ? name.slice(0, 200) : null
}
