module.exports = {
  friendlyName: 'Create app',

  description: 'Create a new app in an environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    name: {
      type: 'string',
      required: true,
      description: 'Human-readable name for the app'
    },
    slug: {
      type: 'string',
      description: 'URL-safe slug (auto-generated from name if omitted)'
    },
    dockerfilePath: {
      type: 'string',
      defaultsTo: 'Dockerfile'
    },
    routePath: {
      type: 'string',
      allowNull: true,
      defaultsTo: '/',
      description: 'Caddy route path (/, /api, or null for workers)'
    }
  },

  exits: {
    success: { statusCode: 201 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function ({ projectSlug, environmentSlug, name, slug, dockerfilePath, routePath }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')
    if (!project || project.team.id !== user.team) throw 'notFound'

    const environment = await Environment.findOne({ project: project.id, slug: environmentSlug })
    if (!environment) throw 'notFound'

    try {
      const app = await App.create({
        name,
        slug: slug || undefined,
        dockerfilePath,
        routePath,
        environment: environment.id,
        isDefault: false
      }).fetch()

      return { app }
    } catch (err) {
      throw { badRequest: { problems: [{ app: err.message }] } }
    }
  }
}
