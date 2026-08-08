const { serializeFeedback } = require('../../lib/bearing-realtime')

module.exports = {
  friendlyName: 'Update Bearing feedback',

  description: 'Move app feedback through the server-owned Bearing lifecycle.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    publicId: { type: 'string', required: true, maxLength: 40 },
    status: {
      type: 'string',
      isIn: ['reviewing', 'planned', 'in_progress', 'shipped', 'closed'],
      required: true
    }
  },

  exits: {
    success: { responseType: 'inertiaRedirect' },
    notFound: { responseType: 'inertiaRedirect' },
    forbidden: { responseType: 'inertiaRedirect' }
  },

  fn: async function ({ slug, envSlug, appSlug, publicId, status }) {
    const resolved = await resolveManager(this.req, {
      slug,
      envSlug,
      appSlug
    })
    const space = await BearingSpace.findOne({ app: resolved.app.id })
    const feedback = space
      ? await BearingFeedback.updateOne({ publicId, space: space.id }).set({
          status
        })
      : null
    if (!feedback) throw { notFound: bearingPath(slug, envSlug, appSlug) }

    await sails.helpers.bearing.broadcastFeedback.with({
      spaceId: String(space.id),
      verb: 'updated',
      feedback: serializeFeedback(feedback)
    })
    await sails.helpers.audit.log.with({
      action: 'bearing.feedback.status.changed',
      resourceType: 'bearing_feedback',
      resourceId: String(feedback.id),
      userId: String(resolved.user.id),
      teamId: String(resolved.user.team),
      ipAddress: this.req.ip,
      details: { status, appId: String(resolved.app.id) }
    })

    sails.inertia.flash('success', 'Feedback status updated.')
    return `${bearingPath(slug, envSlug, appSlug)}?view=feedback`
  }
}

async function resolveManager(req, { slug, envSlug, appSlug }) {
  try {
    return await sails.helpers.bearing.resolveManager.with({
      req,
      projectSlug: slug,
      environmentSlug: envSlug,
      appSlug
    })
  } catch (error) {
    if (error.code === 'forbidden') throw { forbidden: '/' }
    throw { notFound: '/' }
  }
}

function bearingPath(slug, envSlug, appSlug) {
  return `/projects/${slug}/environments/${envSlug}/apps/${appSlug}/bearing`
}
