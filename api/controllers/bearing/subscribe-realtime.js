const {
  roomName,
  serializeFeedback,
  serializeUpdate,
  verifyRealtimeToken
} = require('../../lib/bearing-realtime')

module.exports = {
  friendlyName: 'Subscribe to Bearing feedback',

  description:
    'Join the app-scoped Bearing room and return a reconciliation snapshot.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    token: { type: 'string', required: true }
  },

  exits: {
    badRequest: { statusCode: 400 },
    forbidden: { statusCode: 403 },
    notFound: { statusCode: 404 }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug, token }) {
    if (!this.req.isSocket) throw 'badRequest'

    let resolved
    try {
      resolved = await sails.helpers.bearing.resolvePublicRequest.with({
        req: this.req,
        projectSlug,
        environmentSlug,
        appSlug
      })
    } catch {
      throw 'notFound'
    }

    const origin =
      this.req.socket?.handshake?.headers?.origin ||
      this.req.get('origin') ||
      sails.config.custom.baseUrl
    const payload = verifyRealtimeToken({
      token,
      origin,
      secret: sails.config.session.secret
    })
    if (!payload || payload.spaceId !== String(resolved.space.id)) {
      throw 'forbidden'
    }

    sails.sockets.join(this.req, roomName(resolved.space.id))

    const feedback = await BearingFeedback.find({ space: resolved.space.id })
      .populate('author')
      .sort(['voteCount DESC', 'createdAt DESC', 'id DESC'])
      .limit(100)
    const updates = await sails.helpers.bearing.listUpdates.with({
      spaceId: String(resolved.space.id),
      status: 'published',
      limit: 100
    })

    return {
      feedback: feedback.map(serializeFeedback),
      updates: updates.map(serializeUpdate),
      syncedAt: Date.now()
    }
  }
}
