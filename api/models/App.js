/**
 * App.js
 *
 * Represents a running application container within an environment.
 * Built from the project's Dockerfile.
 */

module.exports = {
  tableName: 'apps',

  attributes: {
    status: {
      type: 'string',
      isIn: ['building', 'starting', 'running', 'stopped', 'failed', 'deploying'],
      defaultsTo: 'stopped',
      description: 'Current status of the app'
    },

    containerId: {
      type: 'string',
      allowNull: true,
      description: 'Docker container ID when running',
      columnName: 'container_id'
    },

    containerName: {
      type: 'string',
      allowNull: true,
      description: 'Docker container name',
      columnName: 'container_name'
    },

    imageId: {
      type: 'string',
      allowNull: true,
      description: 'Docker image ID',
      columnName: 'image_id'
    },

    imageName: {
      type: 'string',
      allowNull: true,
      description: 'Docker image name:tag',
      columnName: 'image_name'
    },

    port: {
      type: 'number',
      allowNull: true,
      description: 'Internal port the container listens on (usually 1337 for Sails)'
    },

    hostPort: {
      type: 'number',
      allowNull: true,
      description: 'Host port mapped to the container',
      columnName: 'host_port'
    },

    lastDeployedAt: {
      type: 'number',
      allowNull: true,
      description: 'Timestamp of last successful deployment',
      columnName: 'last_deployed_at'
    },

    resourceLimits: {
      type: 'json',
      defaultsTo: { cpus: '1', memory: '512m' },
      description: 'Docker resource limits (cpus, memory)',
      columnName: 'resource_limits'
    },

    // Associations
    environment: {
      model: 'environment',
      required: true,
      unique: true
    },

    currentDeployment: {
      model: 'deployment',
      columnName: 'current_deployment_id'
    },

    metrics: {
      collection: 'containermetric',
      via: 'app'
    }
  },

  /**
   * Generate container name from environment
   */
  generateContainerName: async function (environmentId) {
    const env = await Environment.findOne({ id: environmentId }).populate('project')
    if (!env) return null
    return `slipway-${env.project.slug}-${env.slug}`
  },

  /**
   * Generate image name from environment
   */
  generateImageName: async function (environmentId, tag = 'latest') {
    const env = await Environment.findOne({ id: environmentId }).populate('project')
    if (!env) return null
    return `slipway/${env.project.slug}-${env.slug}:${tag}`
  }
}
