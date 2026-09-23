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
