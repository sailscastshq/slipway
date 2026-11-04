module.exports = {
  friendlyName: 'View app Beacon',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    preview: {
      type: 'string',
      isIn: ['', 'healthy', 'down', 'stale'],
      defaultsTo: ''
    }
  },
  exits: {
    success: { responseType: 'inertia' },
    forbidden: { statusCode: 403 }
  },
  fn: async function ({ slug, envSlug, appSlug, preview }) {
    this.res.set('Cache-Control', 'private, no-store')
    const user = await User.forRequest(this.req)
    if (!user?.team || this.req.session?.bridgeAccessId) throw 'forbidden'
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
    const deployment = app.currentDeployment
      ? await Deployment.findOne({
          id: app.currentDeployment,
          app: app.id,
          environment: environment.id
        })
      : null
    const appUrl = await sails.helpers.bridge.getAppUrl.with({
      app,
      environment,
      project
    })
    return {
      page: 'projects/beacon',
      props: {
        project: { name: project.name, slug: project.slug },
        environment: { name: environment.name, slug: environment.slug },
        app: { name: app.name, slug: app.slug, appUrl },
        deployment: deployment
          ? {
              id: deployment.id,
              gitCommit: deployment.gitCommit,
              finishedAt: deployment.finishedAt
            }
          : null,
        checker: { connected: false },
        preview: preview
          ? require('../../lib/beacon/dashboard').example(preview)
          : null
      }
    }
  }
}
