const crypto = require('node:crypto')
const { anonymousIdentity } = require('../../lib/bearing-votes')

module.exports = {
  friendlyName: 'Resolve Bearing voter',

  description:
    'Resolve one identified participant or an opaque signed anonymous visitor.',

  inputs: {
    req: { type: 'ref', required: true },
    resolved: { type: 'ref', required: true },
    createAnonymous: { type: 'boolean', defaultsTo: false }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({ req, resolved, createAnonymous }) {
    if (resolved.participant) {
      return {
        identityKey: `participant:${resolved.participant.id}`,
        participantId: resolved.participant.id,
        anonymous: false
      }
    }

    if (!resolved.space.allowAnonymousParticipation) return null

    let visitorId = req.session?.bearingVisitorId
    if (!visitorId && createAnonymous && req.session) {
      visitorId = crypto.randomBytes(24).toString('base64url')
      req.session.bearingVisitorId = visitorId
    }
    if (!visitorId) return null

    return {
      identityKey: `visitor:${anonymousIdentity(
        visitorId,
        sails.config.session.secret
      )}`,
      participantId: null,
      anonymous: true
    }
  }
}
