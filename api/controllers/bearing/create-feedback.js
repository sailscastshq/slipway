const { normalizeBearingCategories } = require('../../lib/bearing-categories')
const { serializeFeedback } = require('../../lib/bearing-realtime')
const crypto = require('node:crypto')

const IMAGE_FIELDS = ['image0', 'image1', 'image2', 'image3']

module.exports = {
  friendlyName: 'Create Bearing feedback',

  description: 'Submit feedback to one app-owned Bearing space.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    category: { type: 'string', maxLength: 40 },
    title: { type: 'string', required: true, maxLength: 140 },
    details: { type: 'string', maxLength: 5000 },
    imageCount: {
      type: 'number',
      defaultsTo: 0,
      min: 0,
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
    category,
    title,
    details,
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

    if (!resolved.space.acceptFeedback) {
      throw {
        badRequest: {
          error: 'This feedback board is not accepting new submissions.'
        }
      }
    }
    if (!resolved.participant && !resolved.space.allowAnonymousParticipation) {
      throw 'forbidden'
    }

    const normalizedTitle = String(title || '').trim()
    if (!normalizedTitle) {
      throw { badRequest: { error: 'Tell us what you would like to improve.' } }
    }

    const categories = normalizeBearingCategories(
      resolved.space.feedbackCategories
    )
    const selectedCategory =
      category || categories.find((item) => item.active)?.key
    if (
      !categories.some((item) => item.key === selectedCategory && item.active)
    ) {
      throw { badRequest: { error: 'Choose an available feedback category.' } }
    }

    const publicId = `bfd_${crypto.randomBytes(10).toString('base64url')}`
    const imageFields = IMAGE_FIELDS.slice(0, imageCount)
    let images = []
    let storage

    if (imageFields.length) {
      try {
        if (typeof this.req.file !== 'function') {
          throw new Error('This request cannot receive image uploads.')
        }
        storage = await sails.helpers.uploads.getStorageConfig.with({
          requirePublicUrl: true
        })
        images = await sails.helpers.bearing.uploadFeedbackImages.with({
          req: this.req,
          storage,
          fields: imageFields,
          directory: [
            'bearing',
            'teams',
            resolved.project.team,
            'projects',
            resolved.project.id,
            'apps',
            resolved.app.id,
            'feedback',
            publicId
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
    }

    let feedback
    try {
      feedback = await BearingFeedback.create({
        publicId,
        category: selectedCategory,
        title: normalizedTitle,
        details,
        images,
        submittedAnonymously: !resolved.participant,
        author: resolved.participant?.id || null,
        space: resolved.space.id,
        app: resolved.app.id
      }).fetch()
    } catch (error) {
      if (images.length && storage) {
        await sails.helpers.bearing.deleteFeedbackImages
          .with({ storage, images })
          .catch((cleanupError) => {
            sails.log.warn(
              `Could not clean up Bearing feedback images: ${cleanupError.message}`
            )
          })
      }
      throw error
    }

    await sails.helpers.audit.log.with({
      action: 'bearing.feedback.created',
      resourceType: 'bearing_feedback',
      resourceId: String(feedback.id),
      teamId: String(resolved.project.team),
      ipAddress: this.req.ip,
      details: {
        appId: String(resolved.app.id),
        category: selectedCategory,
        imageCount: images.length,
        participantId: resolved.participant
          ? String(resolved.participant.id)
          : null
      }
    })

    await sails.helpers.bearing.broadcastFeedback.with({
      spaceId: String(resolved.space.id),
      verb: 'created',
      feedback: serializeFeedback({
        ...feedback,
        authorName: resolved.participant?.displayName || 'Anonymous'
      })
    })

    sails.inertia.flash('success', 'Thanks—your feedback is now on the board.')
    return `${resolved.publicBasePath}/feedback`
  }
}
