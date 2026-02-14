module.exports = {
  friendlyName: 'Get database service',

  description: 'Find a database service (PostgreSQL, MySQL, MongoDB, or Redis) for an environment.',

  inputs: {
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID'
    },
    serviceId: {
      type: 'string',
      description: 'Specific service ID (optional - if not provided, returns first available)'
    },
    serviceType: {
      type: 'string',
      description: 'Specific service type (optional - postgresql, mysql, mongodb, redis)'
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

  fn: async function ({ environmentId, serviceId, serviceType }) {
    let service

    if (serviceId) {
      // Find specific service by ID
      service = await Service.findOne({
        id: serviceId,
        environment: environmentId,
        status: 'running'
      }).decrypt()
    } else if (serviceType) {
      // Find by type
      service = await Service.findOne({
        environment: environmentId,
        type: serviceType,
        status: 'running'
      }).decrypt()
    } else {
      // Find first available database service
      service = await Service.findOne({
        environment: environmentId,
        type: ['postgresql', 'mysql', 'mongodb', 'redis'],
        status: 'running'
      }).decrypt()
    }

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
