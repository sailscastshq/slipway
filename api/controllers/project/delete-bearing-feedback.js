module.exports = {
  friendlyName: 'Delete Bearing feedback',

  description:
    'Delete app feedback and its votes, update links, and uploaded images.',

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

  fn: async function ({ slug, envSlug, appSlug, publicId }) {
    const resolved = await resolveManager(this.req, {
      slug,
      envSlug,
      appSlug
    })
    const space = await BearingSpace.findOne({ app: resolved.app.id })
    const feedback = space
      ? await BearingFeedback.findOne({ publicId, space: space.id })
      : null
    if (!feedback) throw { notFound: bearingPath(slug, envSlug, appSlug) }

    // Remove objects before the record so storage failures remain retryable.
    if (feedback.images?.length) {
      try {
        const storage = await sails.helpers.uploads.getStorageConfig.with({})
        await sails.helpers.bearing.deleteFeedbackImages.with({
          storage,
          images: feedback.images
        })
      } catch (error) {
        sails.log.warn('Bearing feedback image deletion failed:', error.message)
        sails.inertia.flash(
          'error',
          'Feedback could not be deleted because its attachments could not be removed. Please try again.'
        )
        return `${bearingPath(
          slug,
          envSlug,
          appSlug
        )}?view=feedback&publicId=${encodeURIComponent(publicId)}`
      }
    }
    await BearingVote.destroy({ feedback: feedback.id })
    await BearingUpdateLink.destroy({ feedback: feedback.id })
    await BearingFeedback.destroyOne({ id: feedback.id })

    await sails.helpers.bearing.broadcastFeedback.with({
      spaceId: String(space.id),
      verb: 'removed',
      feedback: { publicId: feedback.publicId }
    })
    await sails.helpers.audit.log.with({
      action: 'bearing.feedback.deleted',
      resourceType: 'bearing_feedback',
      resourceId: String(feedback.id),
      userId: String(resolved.user.id),
      teamId: String(resolved.user.team),
      ipAddress: this.req.ip,
      details: { appId: String(resolved.app.id) }
    })

    sails.inertia.flash('success', 'Feedback deleted.')
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
