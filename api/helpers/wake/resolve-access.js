module.exports = {
  friendlyName: 'Resolve Wake access',
  inputs: {
    req: { type: 'ref', required: true },
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },
  exits: { forbidden: {} },
  fn: async function ({ req, slug, envSlug, appSlug }) {
    const user = await User.forRequest(req)
    if (!user?.team || req.session?.bridgeAccessId) throw 'forbidden'
    const project = await Project.findOne({ slug, team: user.team })
    if (!project) throw 'forbidden'
    const environment = await Environment.findOne({
      slug: envSlug,
      project: project.id
    })
    if (!environment) throw 'forbidden'
    const app = await App.findOne({
      slug: appSlug,
      environment: environment.id
    })
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
