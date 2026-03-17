module.exports = {
  friendlyName: 'Get service',

  description: "Get a service's details including connection URL.",

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Service ID'
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

  fn: async function ({ id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const service = await Service.findOne(id).populate('environment')

    if (!service) {
      throw 'notFound'
    }

    // Get project to check access
    const environment = await Environment.findOne({
      id: service.environment.id
    }).populate('project')

    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const connectionUrl = await Service.getConnectionUrl(service.id)

    return {
      service: {
        id: service.id,
        name: service.name,
        type: service.type,
        version: service.version,
        status: service.status,
        connectionUrl,
        internalHost: service.internalHost,
        internalPort: service.internalPort,
        database: service.database,
        username: service.username,
        containerName: service.containerName,
        environment: {
          id: service.environment.id,
          name: service.environment.name,
          slug: service.environment.slug
        },
        createdAt: service.createdAt
      }
    }
  }
}
