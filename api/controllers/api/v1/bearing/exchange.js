const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Exchange host Bearing identity',

  description:
    'Exchange a verified host-app user for a short-lived Bearing session URL.',

  inputs: {
    appId: { type: 'string', required: true },
    hostUser: { type: 'json', required: true }
  },

  exits: {
    success: { statusCode: 201 },
    badRequest: { statusCode: 400 },
    unauthorized: { statusCode: 401 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({ appId, hostUser }) {
    const app = await App.findOne({ id: appId }).decrypt()
    const presentedSecret = bearerToken(this.req)

    if (
      !app ||
      !app.bearingEnabled ||
      !app.bearingSecret ||
      !safeEqual(presentedSecret, app.bearingSecret)
    ) {
      throw 'unauthorized'
    }

    const email = normalizeEmail(hostUser?.email)
    const hostUserId = normalizeIdentifier(hostUser?.id)
    const displayName = normalizeName(hostUser?.fullName)
    if (!email || !hostUserId || hostUser?.emailVerified !== true) {
      throw {
        badRequest: {
          error:
            'Bearing requires an authenticated host-app user with a verified email address.'
        }
      }
    }

    const space = await BearingSpace.findOne({ app: app.id })
    if (!space) throw 'forbidden'

    const now = Date.now()
    const participantKey = createParticipantKey(space.id, hostUserId)
    let participant = await BearingParticipant.findOne({ participantKey })

    if (participant?.disabledAt) throw 'forbidden'

    if (participant) {
      participant = await BearingParticipant.updateOne({
        id: participant.id,
        space: space.id,
        hostUserId
      }).set({
        email,
        displayName,
        emailVerifiedAt: now,
        lastSeenAt: now
      })
      if (!participant) throw 'forbidden'
    } else {
      participant = await BearingParticipant.create({
        participantKey,
        hostUserId,
        displayName,
        email,
        emailVerifiedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        space: space.id
      }).fetch()
    }

    const code = await sails.helpers.bearing.issueLaunchCode.with({
      participantId: String(participant.id),
      appId: String(app.id)
    })
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
          error: 'Bearing does not have a public app URL for this deployment.'
        }
      }
    }

    await sails.helpers.audit.log.with({
      action: 'bearing.participant.exchanged',
      resourceType: 'app',
      resourceId: String(app.id),
      teamId: String(project.team),
      ipAddress: this.req.ip,
      details: { participantId: String(participant.id) }
    })

    return {
      launchUrl: `${appUrl.replace(
        /\/$/,
        ''
      )}/_slipway/bearing/session?code=${encodeURIComponent(code)}`
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

function createParticipantKey(spaceId, hostUserId) {
  return crypto
    .createHash('sha256')
    .update(`${String(spaceId)}:${hostUserId}`)
    .digest('hex')
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
  return identifier && identifier.length <= 200 ? identifier : null
}

function normalizeName(value) {
  const name = String(value || '').trim()
  return name ? name.slice(0, 200) : null
}
