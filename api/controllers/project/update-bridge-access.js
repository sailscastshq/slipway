module.exports = {
  friendlyName: 'Update Bridge access',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    accessId: { type: 'string', required: true },
    role: {
      type: 'string',
      isIn: ['viewer', 'editor', 'administrator'],
      required: true
    }
  },

  exits: {
    success: { responseType: 'inertiaRedirect' },
    notFound: { responseType: 'inertiaRedirect' },
    forbidden: { responseType: 'inertiaRedirect' }
  },

  fn: async function ({ slug, envSlug, appSlug, accessId, role }) {
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveManager.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        appSlug
      })
    } catch (error) {
      if (error.code === 'forbidden') throw { forbidden: '/' }
      throw { notFound: '/' }
    }

    const access = await BridgeAccess.findOne({
      id: accessId,
      app: resolved.app.id
    })
    if (!access) throw { notFound: accessPath(slug, envSlug, appSlug) }

    await BridgeAccess.updateOne({ id: access.id }).set({ role })
    await sails.helpers.audit.log.with({
      action: 'bridge.access.role_changed',
      resourceType: 'bridgeAccess',
      resourceId: String(access.id),
      userId: String(resolved.user.id),
      teamId: String(resolved.user.team),
      ipAddress: this.req.ip,
      details: { email: access.email, from: access.role, to: role }
    })

    sails.inertia.flash('success', `Updated ${access.email}'s Bridge role.`)
    return accessPath(slug, envSlug, appSlug)
  }
}

function accessPath(projectSlug, environmentSlug, appSlug) {
  return `/projects/${projectSlug}/environments/${environmentSlug}/apps/${appSlug}/bridge/access`
}
