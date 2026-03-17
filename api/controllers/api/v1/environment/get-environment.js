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

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

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
      .decrypt()

    if (!environment) {
      throw 'notFound'
    }

    const { fullDomain, generatedDomain, domains } =
      await Environment.resolveDomains(environment.id)

    // Get Docker health status for all apps
    const apps = await App.find({ environment: environment.id })
    const appsWithHealth = []
    for (const a of apps) {
      let containerHealth = null
      if (a.containerName) {
        try {
          const containerStatus = await sails.helpers.docker.getContainerStatus(
            a.containerName
          )
          containerHealth = containerStatus.health
        } catch {
          // Container not found or inspect failed
        }
      }
      appsWithHealth.push({ ...a, containerHealth })
    }

    return {
      environment: {
        ...environment,
        fullDomain,
        generatedDomain,
        domains,
        app: appsWithHealth,
        containerHealth: appsWithHealth[0]?.containerHealth || null
      }
    }
  }
}
