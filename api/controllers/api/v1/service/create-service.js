module.exports = {
  friendlyName: 'Create service',

  description:
    'Create a new backing service (database, redis, etc.) for an environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production',
      description: 'Environment slug (defaults to production)'
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

  fn: async function ({ projectSlug, environmentSlug, name, type, version }) {
    const { inspectVersion } = require('../../../../lib/service-image-policy')
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

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    }).decrypt()

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
          problems: [
            {
              name: 'A service with this name already exists in this environment.'
            }
          ]
        }
      }
    }

    let versionSelection
    try {
      versionSelection = inspectVersion(type, version)
    } catch (error) {
      throw {
        badRequest: {
          problems: [{ version: error.message }]
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
      version: versionSelection.version,
      status: 'creating',
      containerName,
      internalHost,
      internalPort,
      database: type !== 'redis' ? database : null,
      username: type !== 'redis' ? username : null,
      password,
      environment: environment.id
    }).fetch()

    // Create the Docker container
    try {
      await sails.helpers.docker.createService(service.id)
    } catch (error) {
      throw {
        badRequest: {
          problems: [
            {
              service:
                error?.message ||
                'Docker could not create the service container.'
            }
          ]
        }
      }
    }

    // Get connection URL
    const connectionUrl = await Service.getConnectionUrl(service.id)

    // Auto-inject connection URL into environment variables
    let envVarKey = Service.getDefaultEnvVarKey(type)
    if (envVarKey) {
      const currentVars = environment.envVars || {}
      // If the canonical key is already taken by another service, use SERVICE_NAME_URL
      if (currentVars[envVarKey] !== undefined) {
        envVarKey = `${name.replace(/-/g, '_').toUpperCase()}_URL`
      }
      const updatedVars = { ...currentVars, [envVarKey]: connectionUrl }
      await Environment.updateOne({ id: environment.id }).set({
        envVars: updatedVars
      })
      await Service.updateOne({ id: service.id }).set({ envVarKey })
    }

    sails.log.info(
      `Service ${service.name} (${type}) created for ${project.slug}/${environment.slug}`
    )

    // Audit log
    await sails.helpers.audit.log.with({
      action: 'service.created',
      resourceType: 'service',
      resourceId: service.id,
      details: { name: service.name, type, projectSlug },
      userId: user.id,
      teamId: project.team.id,
      ipAddress: this.req.ip
    })

    return {
      service: {
        id: service.id,
        name: service.name,
        type: service.type,
        version: service.version,
        versionSupport: versionSelection.supported ? 'supported' : 'custom',
        imageReference: (await Service.findOne({ id: service.id }))
          .imageReference,
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
