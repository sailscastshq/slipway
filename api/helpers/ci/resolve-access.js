module.exports = {
  friendlyName: 'Resolve CI app access',
  inputs: {
    req: { type: 'ref', required: true },
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' },
    manage: { type: 'boolean', defaultsTo: false }
  },
  exits: { forbidden: {} },
  fn: async function ({ req, slug, envSlug, appSlug, manage }) {
    const user = await User.forRequest(req)
    if (
      !user?.team ||
      req.session?.bridgeAccessId ||
      (manage && !['owner', 'admin'].includes(user.teamRole))
    )
      throw 'forbidden'
    const project = await Project.findOne({ slug, team: user.team })
    if (!project) throw 'forbidden'
    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })
    if (!environment) throw 'forbidden'
    const app = appSlug
      ? await App.findOne({ environment: environment.id, slug: appSlug })
      : await App.findOne({ environment: environment.id, isDefault: true })
    if (!app) throw 'forbidden'
    return {
      user,
      project,
      environment,
      app,
      canManage: ['owner', 'admin'].includes(user.teamRole)
    }
  }
}
