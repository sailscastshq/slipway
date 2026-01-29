module.exports = {
  friendlyName: 'Create service',

  description: 'Create a new backing service (database, redis, etc.) for an environment.',

  inputs: {
    projectId: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
    },
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID or slug'
    },
    name: {
      type: 'string',
      required: true,
      maxLength: 60,
      regex: /^[a-z0-9-]+$/,
      description: 'Service name (lowercase, alphanumeric, hyphens only)'
    },
    type: {
      type: 'string',
      required: true,
      isIn: ['postgresql', 'mysql', 'redis', 'mongodb'],
      description: 'Type of service'
    },
    version: {
      type: 'string',
      defaultsTo: 'latest',
      description: 'Docker image version/tag'
    }
  },

  exits: {
    success: {
      statusCode: 201
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectId, environmentId, name, type, version }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find project
    let project = await Project.findOne({ id: projectId }).populate('team')
    if (!project) {
      project = await Project.findOne({ slug: projectId }).populate('team')
    }

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Find environment
    let environment = await Environment.findOne({ id: environmentId, project: project.id })
    if (!environment) {
      environment = await Environment.findOne({ slug: environmentId, project: project.id })
    }

    if (!environment) {
      throw 'notFound'
    }

    // Check if service with same name exists in this environment
    const existingService = await Service.findOne({
      name,
      environment: environment.id
    })

    if (existingService) {
      throw {
        badRequest: {
          problems: [{ name: 'A service with this name already exists in this environment.' }]
        }
      }
    }

    // Generate credentials
    const password = await sails.helpers.strings.random('url-friendly')
    const username = `slipway_${name.replace(/-/g, '_')}`
    const database = name.replace(/-/g, '_')

    // Container name will be: slipway-<project>-<env>-<service>
    const containerName = `slipway-${project.slug}-${environment.slug}-${name}`
    const internalHost = containerName // Docker DNS name
    const internalPort = Service.getDefaultPort(type)

    const service = await Service.create({
      name,
      type,
      version,
      status: 'creating',
      containerName,
      internalHost,
      internalPort,
      database: type !== 'redis' ? database : null,
      username: type !== 'redis' ? username : null,
      password,
      environment: environment.id
    }).fetch()

    // TODO: Actually create the Docker container
    // await sails.helpers.docker.createService(service.id)

    // For now, just mark as running (will be implemented properly)
    await Service.updateOne({ id: service.id }).set({
      status: 'running'
    })

    // Get connection URL
    const connectionUrl = await Service.getConnectionUrl(service.id)

    sails.log.info(`Service ${service.name} (${type}) created for ${project.slug}/${environment.slug}`)

    return {
      service: {
        id: service.id,
        name: service.name,
        type: service.type,
        version: service.version,
        status: 'running',
        connectionUrl,
        internalHost: service.internalHost,
        internalPort: service.internalPort,
        database: service.database,
        username: service.username
      }
    }
  }
}
