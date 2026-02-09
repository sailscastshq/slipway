module.exports = {
  friendlyName: 'Get environment',

  description: 'Get a single environment by ID or slug.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    slug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
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

  fn: async function ({ projectSlug, slug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({ project: project.id, slug })
      .populate('app')
      .populate('services')
      .populate('deployments')

    if (!environment) {
      throw 'notFound'
    }

    // Get full domain
    const fullDomain = await Environment.getFullDomain(environment.id)

    // Get Docker health status if app is running
    let containerHealth = null
    const app = await App.findOne({ environment: environment.id })
    if (app && app.containerName) {
      try {
        const containerStatus = await sails.helpers.docker.getContainerStatus(app.containerName)
        containerHealth = containerStatus.health
      } catch {
        // Container not found or inspect failed
      }
    }

    return {
      environment: {
        ...environment,
        fullDomain,
        containerHealth
      }
    }
  }
}
