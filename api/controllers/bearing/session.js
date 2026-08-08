const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Start Bearing session',

  description:
    'Consume a host-issued code and establish an app-scoped participant session.',

  inputs: {
    code: { type: 'string', required: true }
  },

  exits: {
    success: { responseType: 'redirect' },
    forbidden: { responseType: 'redirect' }
  },

  fn: async function ({ code }) {
    const tokenHash = crypto.createHash('sha256').update(code).digest('hex')
    const launchCode = await sails.helpers.bearing.consumeLaunchCode(tokenHash)
    if (!launchCode) {
      throw { forbidden: '/feedback?error=bearing_link_expired' }
    }

    const participant = await BearingParticipant.findOne({
      id: launchCode.participant
    })
    const app = participant
      ? await App.findOne({
          id: launchCode.app,
          bearingEnabled: true
        }).decrypt()
      : null
    const space = app
      ? await BearingSpace.findOne({ id: participant.space, app: app.id })
      : null

    if (!participant || participant.disabledAt || !app || !space) {
      throw { forbidden: '/feedback?error=bearing_access_denied' }
    }

    const existingUserId = this.req.session.userId
    await regenerateSession(this.req)
    if (existingUserId) this.req.session.userId = existingUserId
    this.req.session.bearingParticipantId = participant.id
    this.req.session.bearingAppId = app.id
    this.req.session.bearingAuthenticatedAt = Date.now()
    this.req.session.bearingCredentialHash = hashCredential(app.bearingSecret)

    return `${safeRoutePrefix(app.routePath)}/feedback`
  }
}

function safeRoutePrefix(routePath) {
  if (!routePath || routePath === '/') return ''
  const normalized = `/${String(routePath).replace(/^\/+|\/+$/g, '')}`
  return /^\/[A-Za-z0-9._~/-]*$/.test(normalized) ? normalized : ''
}

function regenerateSession(req) {
  if (typeof req.session.regenerate !== 'function') {
    for (const key of Object.keys(req.session)) delete req.session[key]
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
