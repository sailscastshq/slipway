module.exports = {
  friendlyName: 'Get database service',

  description: 'Find the primary database service (PostgreSQL, MySQL, or MongoDB) for an environment.',

  inputs: {
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID'
    }
  },

  exits: {
    success: {
      description: 'Database service found',
      outputType: 'ref'
    },
    notFound: {
      description: 'No database service found'
    }
  },

  fn: async function ({ environmentId }) {
    // Find PostgreSQL, MySQL, or MongoDB service attached to this environment
    const service = await Service.findOne({
      environment: environmentId,
      type: ['postgresql', 'mysql', 'mongodb'],
      status: 'running'
    })

    if (!service) {
      throw 'notFound'
    }

    return {
      service,
      connectionInfo: {
        type: service.type,
        host: service.containerName, // Docker DNS hostname
        port: Service.getDefaultPort(service.type),
        database: service.database,
        username: service.username,
        password: service.password
      }
    }
  }
}
