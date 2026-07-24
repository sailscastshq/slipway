/**
 * Service.js
 *
 * Represents a backing service (database, cache, etc.) within an environment.
 * Services run as standalone Docker containers on the slipway network.
 */

module.exports = {
  tableName: 'services',

  attributes: {
    name: {
      type: 'string',
      required: true,
      description: 'Service name (used in connection strings)',
      example: 'main-db'
    },

    type: {
      type: 'string',
      required: true,
      isIn: ['postgresql', 'mysql', 'redis', 'mongodb'],
      description: 'Type of service'
    },

    version: {
      type: 'string',
      required: true,
      description: 'Pinned Docker image version line',
      example: '17'
    },

    imageReference: {
      type: 'string',
      allowNull: true,
      description:
        'Immutable Docker digest or image ID used to create the service',
      columnName: 'image_reference'
    },

    imageMetadata: {
      type: 'json',
      description:
        'Resolution provenance and retained recovery details for the service image',
      columnName: 'image_metadata'
    },

    upgradeState: {
      type: 'json',
      description: 'Current or most recent service version upgrade state',
      columnName: 'upgrade_state'
    },

    status: {
      type: 'string',
      isIn: ['creating', 'running', 'stopped', 'upgrading', 'failed'],
      defaultsTo: 'creating',
      description: 'Current status of the service'
    },

    containerId: {
      type: 'string',
      allowNull: true,
      description: 'Docker container ID',
      columnName: 'container_id'
    },

    containerName: {
      type: 'string',
      allowNull: true,
      description: 'Docker container name',
      columnName: 'container_name'
    },

    // Connection details
    internalHost: {
      type: 'string',
      allowNull: true,
      description: 'Internal hostname on Docker network',
      columnName: 'internal_host'
    },

    internalPort: {
      type: 'number',
      allowNull: true,
      description: 'Internal port',
      columnName: 'internal_port'
    },

    database: {
      type: 'string',
      allowNull: true,
      description: 'Database name (for SQL databases)'
    },

    username: {
      type: 'string',
      allowNull: true,
      description: 'Database username'
    },

    password: {
      type: 'string',
      allowNull: true,
      protect: true,
      encrypt: true,
      description: 'Database password'
    },

    envVarKey: {
      type: 'string',
      allowNull: true,
      description:
        'The env var key this service auto-manages (e.g. DATABASE_URL)',
      columnName: 'env_var_key'
    },

    resourceLimits: {
      type: 'json',
      defaultsTo: { cpus: '0.5', memory: '256m' },
      description: 'Docker resource limits (cpus, memory)',
      columnName: 'resource_limits'
    },

    // Associations
    environment: {
      model: 'environment',
      required: true
    },

    backups: {
      collection: 'backup',
      via: 'service'
    },

    metrics: {
      collection: 'containermetric',
      via: 'service'
    }
  },

  /**
   * Whether this service type supports backups
   */
  isBackupSupported: function (type) {
    return ['postgresql', 'mysql', 'mongodb'].includes(type)
  },

  /**
   * Get default env var key for a service type
   */
  getDefaultEnvVarKey: function (type) {
    const keys = {
      postgresql: 'DATABASE_URL',
      mysql: 'DATABASE_URL',
      redis: 'REDIS_URL',
      mongodb: 'DATABASE_URL'
    }
    return keys[type] || null
  },

  /**
   * Get default port for service type
   */
  getDefaultPort: function (type) {
    const ports = {
      postgresql: 5432,
      mysql: 3306,
      redis: 6379,
      mongodb: 27017
    }
    return ports[type] || 5432
  },

  /**
   * Get the durable Docker volume name for a service container
   */
  getDataVolumeName: function (containerName) {
    return `slipway-${containerName}-data`
  },

  /**
   * Get Docker image for service type
   */
  getDockerImage: function (type, version) {
    const { inspectVersion } = require('../lib/service-image-policy')
    return inspectVersion(type, version).imageTag
  },

  /**
   * Generate connection URL for the service
   */
  getConnectionUrl: async function (serviceId) {
    const service = await Service.findOne({ id: serviceId }).decrypt()
    if (!service) return null

    switch (service.type) {
      case 'postgresql':
        return `postgres://${service.username}:${service.password}@${service.internalHost}:${service.internalPort}/${service.database}`
      case 'mysql':
        return `mysql://${service.username}:${service.password}@${service.internalHost}:${service.internalPort}/${service.database}`
      case 'redis':
        if (service.password) {
          return `redis://:${service.password}@${service.internalHost}:${service.internalPort}`
        }
        return `redis://${service.internalHost}:${service.internalPort}`
      case 'mongodb':
        return `mongodb://${service.username}:${service.password}@${service.internalHost}:${service.internalPort}/${service.database}`
      default:
        return null
    }
  },

  /**
   * Generate container name for service
   */
  generateContainerName: async function (serviceId) {
    const service = await Service.findOne({ id: serviceId }).populate(
      'environment'
    )
    if (!service) return null

    const env = await Environment.findOne({
      id: service.environment.id
    }).populate('project')
    return `slipway-${env.project.slug}-${env.slug}-${service.name}`
  }
}
