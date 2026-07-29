module.exports = {
  friendlyName: 'Resolve project Helm scope',

  description:
    'Resolve and authorize the current user, project, environment, and target app for Helm.',

  inputs: {
    userId: {
      type: 'number',
      required: true
    },
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    appSlug: {
      type: 'string'
    }
  },

  exits: {
    notFound: {},
    forbidden: {}
  },

  fn: async function ({ userId, projectSlug, environmentSlug, appSlug }) {
    const user = await User.findOne({ id: userId })
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!user || !project) throw 'notFound'
    if (Number(project.team.id) !== Number(user.team)) throw 'forbidden'

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    let app
    if (appSlug) {
      app = await App.findOne({
        environment: environment.id,
        slug: appSlug
      })
    } else {
      app =
        (await App.findOne({
          environment: environment.id,
          isDefault: true
        })) || (await App.findOne({ environment: environment.id }))
    }

    if (!app) throw 'notFound'

    app = await App.findOne({ id: app.id }).populate('currentDeployment')

    return { user, project, environment, app }
  }
}
