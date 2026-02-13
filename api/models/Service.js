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
      defaultsTo: 'latest',
      description: 'Docker image version/tag',
      example: '16'
    },

    status: {
      type: 'string',
      isIn: ['creating', 'running', 'stopped', 'failed'],
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
      description: 'The env var key this service auto-manages (e.g. DATABASE_URL)',
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
   * Get Docker image for service type
   */
  getDockerImage: function (type, version = 'latest') {
    const images = {
      postgresql: `postgres:${version}`,
      mysql: `mysql:${version}`,
      redis: `redis:${version}`,
      mongodb: `mongo:${version}`
    }
    return images[type] || `postgres:${version}`
  },

  /**
   * Generate connection URL for the service
   */
  getConnectionUrl: async function (serviceId) {
    const service = await Service.findOne({ id: serviceId })
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
    const service = await Service.findOne({ id: serviceId }).populate('environment')
    if (!service) return null

    const env = await Environment.findOne({ id: service.environment.id }).populate('project')
    return `slipway-${env.project.slug}-${env.slug}-${service.name}`
  }
}
