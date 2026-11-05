const page = require('../../lib/beacon/public-page')
module.exports = {
  friendlyName: 'Update public Beacon page',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true }
  },
  exits: {
    success: { responseType: 'inertiaRedirect' },
    forbidden: { statusCode: 403 },
    badRequest: { statusCode: 400 }
  },
  fn: async function ({ slug, envSlug, appSlug, enabled }) {
    const user = await User.forRequest(this.req)
    if (
      !user?.team ||
      !['owner', 'admin'].includes(user.teamRole) ||
      this.req.session?.bridgeAccessId
    )
      throw 'forbidden'
    const project = await Project.findOne({ slug, team: user.team })
    const environment = project
      ? await Environment.findOne({ slug: envSlug, project: project.id })
      : null
    const app = environment
      ? await App.findOne({ slug: appSlug, environment: environment.id })
      : null
    if (!app) throw 'forbidden'
    if (enabled) {
      const conflict = page.conflict(
        app,
        await App.find({ environment: environment.id })
      )
      if (conflict) throw { badRequest: { message: conflict } }
    }
    await sails.helpers.setting.set(
      page.key(app.id),
      JSON.stringify({ enabled })
    )
    await sails.helpers.audit.log.with({
      action: 'beacon.public.updated',
      resourceType: 'app',
      resourceId: String(app.id),
      userId: String(user.id),
      teamId: String(user.team),
      ipAddress: this.req.ip,
      details: { enabled }
    })
    sails.inertia.flash(
      'success',
      enabled
        ? 'Public Beacon page enabled. Redeploy this app to activate its route. Monitoring is not connected.'
        : 'Public Beacon page disabled. Redeploy to remove its route.'
    )
    return `/projects/${slug}/environments/${envSlug}/apps/${appSlug}/beacon`
  }
}
