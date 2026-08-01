module.exports = {
  friendlyName: 'Update Bridge settings',

  description: 'Enable or disable the app-local Bridge entry point.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true }
  },

  exits: {
    success: { responseType: 'inertiaRedirect' },
    notFound: { responseType: 'inertiaRedirect' },
    forbidden: { responseType: 'inertiaRedirect' }
  },

  fn: async function ({ slug, envSlug, appSlug, enabled }) {
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

    const { user, project, app } = resolved
    if (enabled) {
      // Rotate on every disabled -> enabled transition. This makes credentials
      // in an old container unusable until the app is deliberately redeployed.
      await sails.helpers.bridge.ensureAppSecret.with({
        appId: String(app.id),
        rotate: !app.bridgeEnabled
      })
    }
    await App.updateOne({ id: app.id }).set({ bridgeEnabled: enabled })

    await sails.helpers.audit.log.with({
      action: enabled ? 'bridge.enabled' : 'bridge.disabled',
      resourceType: 'app',
      resourceId: String(app.id),
      userId: String(user.id),
      teamId: String(user.team),
      ipAddress: this.req.ip,
      details: { project: project.slug, app: app.slug }
    })

    sails.inertia.flash(
      'success',
      enabled
        ? 'Bridge enabled. Redeploy this app to activate its /bridge entry point.'
        : 'Bridge access disabled.'
    )
    return accessPath(project.slug, resolved.environment.slug, app.slug)
  }
}

function accessPath(projectSlug, environmentSlug, appSlug) {
  return `/projects/${projectSlug}/environments/${environmentSlug}/apps/${appSlug}/bridge/access`
}
