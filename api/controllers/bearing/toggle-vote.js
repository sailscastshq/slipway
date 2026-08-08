const { serializeFeedback } = require('../../lib/bearing-realtime')
const { voteKey } = require('../../lib/bearing-votes')

module.exports = {
  friendlyName: 'Toggle Bearing vote',

  description: 'Add or remove one app-scoped feedback vote.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    publicId: { type: 'string', required: true, maxLength: 40 }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug, publicId }) {
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

    const feedback = await BearingFeedback.findOne({
      publicId,
      space: resolved.space.id,
      app: resolved.app.id
    }).populate('author')
    if (!feedback) throw 'notFound'

    const voter = await sails.helpers.bearing.resolveVoter.with({
      req: this.req,
      resolved,
      createAnonymous: true
    })
    if (!voter) throw 'forbidden'

    const opaqueVoteKey = voteKey(feedback.id, voter.identityKey)
    let voted = false
    let updatedFeedback

    await sails.getDatastore().transaction(async (db) => {
      const existing = await BearingVote.findOne({
        voterKey: opaqueVoteKey,
        feedback: feedback.id,
        space: resolved.space.id
      }).usingConnection(db)

      if (existing) {
        await BearingVote.destroyOne({ id: existing.id }).usingConnection(db)
      } else {
        try {
          await BearingVote.create({
            voterKey: opaqueVoteKey,
            participant: voter.participantId,
            feedback: feedback.id,
            space: resolved.space.id
          }).usingConnection(db)
          voted = true
        } catch (error) {
          if (error.code !== 'E_UNIQUE') throw error
          voted = true
        }
      }

      const voteCount = await BearingVote.count({
        feedback: feedback.id,
        space: resolved.space.id
      }).usingConnection(db)
      updatedFeedback = await BearingFeedback.updateOne({
        id: feedback.id,
        space: resolved.space.id
      })
        .set({ voteCount })
        .usingConnection(db)
    })

    const publicFeedback = serializeFeedback({
      ...updatedFeedback,
      authorName: feedback.author?.displayName
    })
    await sails.helpers.bearing.broadcastFeedback.with({
      spaceId: String(resolved.space.id),
      verb: 'updated',
      feedback: publicFeedback
    })

    return {
      voted,
      voteCount: updatedFeedback.voteCount,
      feedback: { ...publicFeedback, viewerHasVoted: voted }
    }
  }
}
