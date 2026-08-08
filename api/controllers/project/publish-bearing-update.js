const {
  serializeFeedback,
  serializeUpdate
} = require('../../lib/bearing-realtime')

module.exports = {
  friendlyName: 'Publish Bearing update',

  description:
    'Publish one draft and atomically mark its linked feedback as shipped.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    publicId: { type: 'string', required: true, maxLength: 40 }
  },

  exits: {
    success: { responseType: 'inertiaRedirect' },
    notFound: { responseType: 'inertiaRedirect' },
    forbidden: { responseType: 'inertiaRedirect' }
  },

  fn: async function (inputs) {
    const resolved = await resolveManager(this.req, inputs)
    const space = await BearingSpace.findOne({ app: resolved.app.id })
    const draft = space
      ? await BearingUpdate.findOne({
          publicId: inputs.publicId,
          space: space.id,
          status: 'draft'
        })
      : null
    if (!draft) throw { notFound: bearingPath(inputs) }

    const links = await BearingUpdateLink.find({
      update: draft.id,
      space: space.id
    })
    const linkedFeedback = links.length
      ? await BearingFeedback.find({
          id: { in: links.map((link) => link.feedback) },
          space: space.id
        })
      : []
    const author = await User.findOne({ id: draft.author })
    let update
    await sails.getDatastore().transaction(async (db) => {
      update = await BearingUpdate.updateOne({
        id: draft.id,
        status: 'draft'
      })
        .set({ status: 'published', publishedAt: Date.now() })
        .usingConnection(db)
      if (!update) throw new Error('This update is no longer a draft.')
      if (linkedFeedback.length) {
        await BearingFeedback.update({
          id: { in: linkedFeedback.map((feedback) => feedback.id) },
          space: space.id
        })
          .set({ status: 'shipped' })
          .usingConnection(db)
      }
    })

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
      update: serializeUpdate({ ...update, author, linkedFeedback })
    })

    sails.inertia.flash('success', 'Update published.')
    return `${bearingPath(inputs)}?view=updates`
  }
}

async function resolveManager(req, inputs) {
  try {
    return await sails.helpers.bearing.resolveManager.with({
      req,
      projectSlug: inputs.slug,
      environmentSlug: inputs.envSlug,
      appSlug: inputs.appSlug
    })
  } catch (error) {
    if (error.code === 'forbidden') throw { forbidden: '/' }
    throw { notFound: '/' }
  }
}

function bearingPath({ slug, envSlug, appSlug }) {
  return `/projects/${slug}/environments/${envSlug}/apps/${appSlug}/bearing`
}
