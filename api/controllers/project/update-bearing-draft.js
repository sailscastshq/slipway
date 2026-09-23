const crypto = require('node:crypto')
const {
  serializeFeedback,
  serializeUpdate
} = require('../../lib/bearing-realtime')

module.exports = {
  friendlyName: 'Update Bearing draft',

  description: 'Save or publish changes to an existing app-scoped draft.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    publicId: { type: 'string', required: true, maxLength: 40 },
    title: { type: 'string', required: true, maxLength: 140 },
    excerpt: { type: 'string', required: true, maxLength: 280 },
    body: { type: 'string', required: true, maxLength: 10000 },
    feedbackIds: { type: 'ref', defaultsTo: [] },
    publish: { type: 'boolean', defaultsTo: false }
  },

  exits: {
    success: { responseType: 'inertiaRedirect' },
    badRequest: { responseType: 'badRequest' },
    notFound: { responseType: 'inertiaRedirect' },
    forbidden: { responseType: 'inertiaRedirect' }
  },

  fn: async function (inputs) {
    let resolved
    try {
      resolved = await sails.helpers.bearing.resolveManager.with({
        req: this.req,
        projectSlug: inputs.slug,
        environmentSlug: inputs.envSlug,
        appSlug: inputs.appSlug
      })
    } catch (error) {
      if (error.code === 'forbidden') throw { forbidden: '/' }
      throw { notFound: '/' }
    }

    const path = `/projects/${inputs.slug}/environments/${inputs.envSlug}/apps/${inputs.appSlug}/bearing`
    const space = await BearingSpace.findOne({ app: resolved.app.id })
    const draft = space
      ? await BearingUpdate.findOne({
          publicId: inputs.publicId,
          space: space.id,
          app: resolved.app.id,
          status: 'draft'
        })
      : null
    if (!draft) throw { notFound: `${path}?view=updates` }

    const title = String(inputs.title || '').trim()
    const excerpt = String(inputs.excerpt || '').trim()
    const body = String(inputs.body || '').trim()
    if (!title || !excerpt || !body) {
      throw {
        badRequest: {
          problems: [{ update: 'Add a title, summary, and useful details.' }]
        }
      }
    }

    const requestedIds = [
      ...new Set(
        (Array.isArray(inputs.feedbackIds) ? inputs.feedbackIds : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
          .slice(0, 100)
      )
    ]
    const linkedFeedback = requestedIds.length
      ? await BearingFeedback.find({
          publicId: { in: requestedIds },
          space: space.id,
          app: resolved.app.id
        })
      : []
    if (linkedFeedback.length !== requestedIds.length) {
      throw {
        badRequest: {
          problems: [
            { feedbackIds: 'Choose feedback from this Bearing space.' }
          ]
        }
      }
    }

    let update
    await sails.getDatastore().transaction(async (db) => {
      update = await BearingUpdate.updateOne({ id: draft.id, status: 'draft' })
        .set({
          title,
          excerpt,
          body,
          ...(inputs.publish
            ? { status: 'published', publishedAt: Date.now() }
            : {})
        })
        .usingConnection(db)
      if (!update) throw new Error('This update is no longer a draft.')

      await BearingUpdateLink.destroy({
        update: draft.id,
        space: space.id
      }).usingConnection(db)
      if (linkedFeedback.length) {
        await BearingUpdateLink.createEach(
          linkedFeedback.map((feedback) => ({
            linkKey: crypto
              .createHash('sha256')
              .update(`${String(draft.id)}:${String(feedback.id)}`)
              .digest('hex'),
            update: draft.id,
            feedback: feedback.id,
            space: space.id
          }))
        ).usingConnection(db)
      }
      if (inputs.publish && linkedFeedback.length) {
        await BearingFeedback.update({
          id: { in: linkedFeedback.map((feedback) => feedback.id) },
          space: space.id
        })
          .set({ status: 'shipped' })
          .usingConnection(db)
      }
    })

    if (inputs.publish) {
      for (const feedback of linkedFeedback) {
        await sails.helpers.bearing.broadcastFeedback.with({
          spaceId: String(space.id),
          verb: 'updated',
          feedback: serializeFeedback({ ...feedback, status: 'shipped' })
        })
      }
      await sails.helpers.bearing.broadcastUpdate.with({
        spaceId: String(space.id),
        verb: 'published',
        update: serializeUpdate({
          ...update,
          author: resolved.user,
          linkedFeedback
        })
      })
    }

    await sails.helpers.audit.log.with({
      action: inputs.publish
        ? 'bearing.update.published'
        : 'bearing.update.drafted',
      resourceType: 'bearing_update',
      resourceId: String(update.id),
      userId: String(resolved.user.id),
      teamId: String(resolved.user.team),
      ipAddress: this.req.ip,
      details: { appId: String(resolved.app.id) }
    })
    sails.inertia.flash(
      'success',
      inputs.publish ? 'Update published.' : 'Draft updated.'
    )
    return `${path}?view=updates`
  }
}
