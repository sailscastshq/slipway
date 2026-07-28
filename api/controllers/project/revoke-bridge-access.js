module.exports = {
  friendlyName: 'Revoke Bridge access',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    accessId: { type: 'string', required: true }
  },

  exits: {
    success: { responseType: 'redirect' },
    notFound: { responseType: 'redirect' },
    forbidden: { responseType: 'redirect' }
  },

  fn: async function ({ slug, envSlug, appSlug, accessId }) {
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

    await BridgeAccess.updateOne({ id: access.id }).set({
      status: 'revoked',
      revokedAt: Date.now(),
      revokedBy: resolved.user.id,
      inviteTokenHash: null,
      inviteExpiresAt: null
    })
    await BridgeLaunchCode.destroy({ access: access.id })

    await sails.helpers.audit.log.with({
      action: 'bridge.access.revoked',
      resourceType: 'bridgeAccess',
      resourceId: String(access.id),
      userId: String(resolved.user.id),
      teamId: String(resolved.user.team),
      ipAddress: this.req.ip,
      details: { email: access.email, role: access.role }
    })

    sails.inertia.flash('success', `Revoked ${access.email}'s Bridge access.`)
    return accessPath(slug, envSlug, appSlug)
  }
}

function accessPath(projectSlug, environmentSlug, appSlug) {
  return `/projects/${projectSlug}/environments/${environmentSlug}/apps/${appSlug}/bridge/access`
}
