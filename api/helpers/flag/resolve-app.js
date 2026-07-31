module.exports = {
  friendlyName: 'Resolve release flag app',

  description: 'Resolve an app inside the signed-in user team.',

  inputs: {
    userId: { type: 'string', required: true },
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },

  exits: {
    success: { outputType: 'ref' },
    notFound: {}
  },

  fn: async function ({ userId, projectSlug, environmentSlug, appSlug }) {
    const user = await User.findOne({ id: userId })
    if (!user) throw 'notFound'

    const project = await Project.findOne({
      slug: projectSlug,
      team: user.team
    })
    if (!project) throw 'notFound'

    const environment = await Environment.findOne({
      slug: environmentSlug,
      project: project.id
    })
    if (!environment) throw 'notFound'

    const app = await App.findOne({
      slug: appSlug,
      environment: environment.id
    })
    if (!app) throw 'notFound'

    return { user, project, environment, app }
  }
}
