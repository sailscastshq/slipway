module.exports = {
  friendlyName: 'Get deployment readiness',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    app: { type: 'string' },
    previousVersion: { type: 'string' }
  },
  exits: { notFound: { statusCode: 404 }, forbidden: { statusCode: 403 } },
  fn: async function ({ projectSlug, environmentSlug, app, previousVersion }) {
    const user = await User.forRequest(this.req)
    const project = await Project.findOne({ slug: projectSlug })
    if (!project) throw 'notFound'
    if (project.team !== user.team) throw 'forbidden'
    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'
    const target = app
      ? await App.findOne({ environment: environment.id, slug: app })
      : null
    if (app && !target) throw 'notFound'
    const report = await sails.helpers.environment.getReadiness.with({
      environmentId: environment.id,
      ...(target ? { appId: target.id } : {})
    })
    return {
      ...report,
      stale: Boolean(previousVersion && previousVersion !== report.version)
    }
  }
}
