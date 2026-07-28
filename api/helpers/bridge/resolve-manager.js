module.exports = {
  friendlyName: 'Resolve Bridge manager',

  description:
    'Resolve an app and require a Slipway owner or administrator from its team.',

  inputs: {
    req: {
      type: 'ref',
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
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    forbidden: {},
    notFound: {}
  },

  fn: async function ({ req, projectSlug, environmentSlug, appSlug }) {
    const user = await User.findOne({ id: req.session.userId })
    if (!user || !['owner', 'admin'].includes(user.teamRole)) {
      throw 'forbidden'
    }

    const project = await Project.findOne({
      slug: projectSlug,
      team: user.team
    })
    if (!project) throw 'notFound'

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    const app = await App.findOne({
      environment: environment.id,
      slug: appSlug
    })
    if (!app) throw 'notFound'

    return { user, project, environment, app }
  }
}
