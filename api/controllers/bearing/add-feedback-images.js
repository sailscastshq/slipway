const { serializeFeedback } = require('../../lib/bearing-realtime')

const IMAGE_FIELDS = ['image0', 'image1', 'image2', 'image3']

module.exports = {
  friendlyName: 'Add Bearing feedback images',
  description:
    'Let the verified author attach missing images to their feedback.',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    publicId: { type: 'string', required: true, maxLength: 40 },
    imageCount: {
      type: 'number',
      required: true,
      min: 1,
      max: IMAGE_FIELDS.length,
      isInteger: true
    }
  },

  exits: {
    success: { responseType: 'inertiaRedirect' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    appSlug,
    publicId,
    imageCount
  }) {
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
    if (
      !resolved.participant ||
      feedback.submittedAnonymously ||
      String(feedback.author?.id) !== String(resolved.participant.id)
    ) {
      throw 'forbidden'
    }

    const previousImages = Array.isArray(feedback.images) ? feedback.images : []
    if (previousImages.length + imageCount > IMAGE_FIELDS.length) {
      throw {
        badRequest: {
          problems: [{ images: 'This feedback can have up to 4 images.' }]
        }
      }
    }

    let storage
    let images
    try {
      storage = await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
      images = await sails.helpers.bearing.uploadFeedbackImages.with({
        req: this.req,
        storage,
        fields: IMAGE_FIELDS.slice(0, imageCount),
        directory: [
          'bearing',
          'teams',
          resolved.project.team,
          'projects',
          resolved.project.id,
          'apps',
          resolved.app.id,
          'feedback',
          feedback.publicId
        ].join('/')
      })
    } catch (error) {
      throw {
        badRequest: {
          problems: [
            {
              images:
                error.message ||
                'Those images could not be uploaded. Please try again.'
            }
          ]
        }
      }
    }

    let updated
    try {
      updated = await BearingFeedback.updateOne({
        id: feedback.id,
        updatedAt: feedback.updatedAt
      }).set({ images: [...previousImages, ...images] })
      if (!updated) {
        throw new Error(
          'Feedback changed while the images were uploading. Please try again.'
        )
      }
    } catch (error) {
      await sails.helpers.bearing.deleteFeedbackImages
        .with({ storage, images })
        .catch((cleanupError) =>
          sails.log.warn(
            `Could not clean up Bearing images after update: ${cleanupError.message}`
          )
        )
      throw { badRequest: { problems: [{ images: error.message }] } }
    }

    await sails.helpers.audit.log.with({
      action: 'bearing.feedback.images.added',
      resourceType: 'bearing_feedback',
      resourceId: String(feedback.id),
      teamId: String(resolved.project.team),
      ipAddress: this.req.ip,
      details: {
        appId: String(resolved.app.id),
        participantId: String(resolved.participant.id),
        imageCount: images.length
      }
    })
    await sails.helpers.bearing.broadcastFeedback.with({
      spaceId: String(resolved.space.id),
      verb: 'updated',
      feedback: serializeFeedback({
        ...updated,
        authorName: resolved.participant.displayName
      })
    })

    sails.inertia.flash('success', 'Screenshots added to your feedback.')
    return `${resolved.publicBasePath}/feedback/${encodeURIComponent(publicId)}`
  }
}
