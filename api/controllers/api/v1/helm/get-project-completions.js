module.exports = {
  friendlyName: 'Get project Helm completions',

  description:
    'Return secret-free Sails completion metadata from the environment default app.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) throw 'notFound'
    if (project.team.id !== user.team) throw 'forbidden'

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))

    this.res.set('Cache-Control', 'private, no-store')

    if (!app || app.status !== 'running' || !app.containerName) {
      return {
        available: false,
        version: 1,
        truncated: false,
        models: [],
        helpers: [],
        config: []
      }
    }

    try {
      return await sails.helpers.helm.getCompletions(app.containerName)
    } catch {
      return {
        available: false,
        version: 1,
        truncated: false,
        models: [],
        helpers: [],
        config: []
      }
    }
  }
}
