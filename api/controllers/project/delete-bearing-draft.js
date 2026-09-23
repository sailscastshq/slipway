const {
  imageUrls,
  ownedImagePaths
} = require('../../lib/bearing-update-images')

module.exports = {
  friendlyName: 'Delete Bearing draft',

  description: 'Delete an unpublished app-scoped update and its links.',

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

    const path = `/projects/${inputs.slug}/environments/${inputs.envSlug}/apps/${inputs.appSlug}/bearing?view=updates`
    const space = await BearingSpace.findOne({ app: resolved.app.id })
    const draft = space
      ? await BearingUpdate.findOne({
          publicId: inputs.publicId,
          space: space.id,
          app: resolved.app.id,
          status: 'draft'
        })
      : null
    if (!draft) throw { notFound: path }

    const directory = [
      'bearing',
      'teams',
      resolved.user.team,
      'projects',
      resolved.project.id,
      'apps',
      resolved.app.id,
      'updates',
      'assets'
    ].join('/')
    const candidateUrls = imageUrls(draft.body)
    if (candidateUrls.size) {
      let storage
      try {
        storage = await sails.helpers.uploads.getStorageConfig.with({
          requirePublicUrl: true
        })
      } catch (error) {
        // An external image must not prevent a draft from being discarded.
        if ([...candidateUrls].some((url) => url.includes(`/${directory}/`))) {
          sails.inertia.flash(
            'error',
            'The draft could not be deleted because file storage is unavailable. Restore storage settings and try again.'
          )
          return path
        }
      }

      if (storage) {
        const owned = ownedImagePaths(draft.body, {
          publicUrl: storage.publicUrl,
          directory
        })
        if (owned.size) {
          const otherUpdates = await BearingUpdate.find({
            space: space.id,
            app: resolved.app.id,
            id: { '!=': draft.id }
          }).select(['body'])
          const shared = new Set(
            otherUpdates.flatMap((update) => [
              ...ownedImagePaths(update.body, {
                publicUrl: storage.publicUrl,
                directory
              })
            ])
          )
          const images = [...owned]
            .filter((objectPath) => !shared.has(objectPath))
            .map((objectPath) => ({ objectPath }))
          if (images.length) {
            try {
              await sails.helpers.bearing.deleteFeedbackImages.with({
                storage,
                images
              })
            } catch (error) {
              sails.log.warn(
                'Bearing draft image deletion failed:',
                error.message
              )
              sails.inertia.flash(
                'error',
                'The draft could not be deleted because its images could not be removed. Please try again.'
              )
              return path
            }
          }
        }
      }
    }

    await sails.getDatastore().transaction(async (db) => {
      await BearingUpdateLink.destroy({
        update: draft.id,
        space: space.id
      }).usingConnection(db)
      const deleted = await BearingUpdate.destroyOne({
        id: draft.id,
        status: 'draft'
      }).usingConnection(db)
      if (!deleted) throw new Error('This update is no longer a draft.')
    })
    await sails.helpers.audit.log.with({
      action: 'bearing.update.deleted',
      resourceType: 'bearing_update',
      resourceId: String(draft.id),
      userId: String(resolved.user.id),
      teamId: String(resolved.user.team),
      ipAddress: this.req.ip,
      details: { appId: String(resolved.app.id) }
    })
    sails.inertia.flash('success', 'Draft deleted.')
    return path
  }
}
