/**
 * App.js
 *
 * Represents a running application container within an environment.
 * Multiple apps can belong to one environment (e.g. web + worker).
 * Built from the project's Dockerfile (or a per-app Dockerfile).
 */

module.exports = {
  tableName: 'apps',

  attributes: {
    name: {
      type: 'string',
      defaultsTo: 'app',
      description: 'Human-readable name for this app'
    },

    slug: {
      type: 'string',
      defaultsTo: 'app',
      regex: /^[a-z0-9-]+$/,
      description: 'URL-safe identifier (unique per environment)'
    },

    status: {
      type: 'string',
      isIn: [
        'building',
        'starting',
        'running',
        'stopped',
        'failed',
        'deploying'
      ],
      defaultsTo: 'stopped',
      description: 'Current status of the app'
    },

    dockerfilePath: {
      type: 'string',
      defaultsTo: 'Dockerfile',
      description: 'Path to Dockerfile relative to project root',
      columnName: 'dockerfile_path'
    },

    routePath: {
      type: 'string',
      allowNull: true,
      defaultsTo: '/',
      description: 'Caddy route path prefix (/, /api, or null for workers)',
      columnName: 'route_path'
    },

    healthPath: {
      type: 'string',
      defaultsTo: '/health',
      description: 'HTTP path probed before deployment traffic switches',
      columnName: 'health_path'
    },

    envVars: {
      type: 'json',
      defaultsTo: {},
      description: 'App-specific environment variable overrides',
      columnName: 'app_env_vars'
    },

    isDefault: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Whether this is the primary/default app in the environment',
      columnName: 'is_default'
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
      description:
        'Internal port the container listens on (usually 1337 for Sails)'
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

    bridgeEnabled: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Whether the app-local Bridge entry point is enabled',
      columnName: 'bridge_enabled'
    },

    bridgeSecret: {
      type: 'string',
      allowNull: true,
      encrypt: true,
      protect: true,
      description:
        'App-specific credential used for the host-to-Slipway Bridge exchange',
      columnName: 'bridge_secret'
    },

    // Associations
    environment: {
      model: 'environment',
      required: true
    },

    currentDeployment: {
      model: 'deployment',
      columnName: 'current_deployment_id'
    },

    deployments: {
      collection: 'deployment',
      via: 'app'
    }
  },

  /**
   * Enforce compound uniqueness (environment + slug) and auto-set isDefault.
   */
  beforeCreate: async function (values, proceed) {
    values.healthPath = App.normalizeHealthPath(values.healthPath)

    // Auto-generate slug from name if name was provided but slug wasn't explicitly set
    if (
      values.name &&
      values.name !== 'app' &&
      (!values.slug || values.slug === 'app')
    ) {
      values.slug = values.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    }

    // Enforce compound uniqueness: environment + slug
    if (values.environment && values.slug) {
      const existing = await App.findOne({
        environment: values.environment,
        slug: values.slug
      })
      if (existing) {
        return proceed(
          new Error(
            `An app with slug "${values.slug}" already exists in this environment.`
          )
        )
      }
    }

    // First app in environment is always default
    if (values.environment) {
      const count = await App.count({ environment: values.environment })
      if (count === 0) {
        values.isDefault = true
      } else if (values.isDefault) {
        // If this app is marked as default, unmark others
        await App.update({
          environment: values.environment,
          isDefault: true
        }).set({ isDefault: false })
      }
    }

    return proceed()
  },

  beforeUpdate: async function (values, proceed) {
    if (values.healthPath !== undefined) {
      values.healthPath = App.normalizeHealthPath(values.healthPath)
    }

    return proceed()
  },

  normalizeHealthPath: function (healthPath) {
    const path = String(healthPath || '/health').trim()
    if (!path) return '/health'
    return path.startsWith('/') ? path : `/${path}`
  },

  /**
   * Generate container name from environment and optional app slug.
   * Default app ('app') omits the suffix for backward compatibility.
   */
  generateContainerName: async function (environmentId, appSlug) {
    const env = await Environment.findOne({ id: environmentId }).populate(
      'project'
    )
    if (!env) return null
    const base = `slipway-${env.project.slug}-${env.slug}`
    if (!appSlug || appSlug === 'app') return base
    return `${base}-${appSlug}`
  },

  /**
   * Generate a deploy-scoped container name (used during blue-green deployment)
   */
  generateDeployContainerName: async function (
    environmentId,
    deploymentId,
    appSlug
  ) {
    const env = await Environment.findOne({ id: environmentId }).populate(
      'project'
    )
    if (!env) return null
    const base = `slipway-${env.project.slug}-${env.slug}`
    if (!appSlug || appSlug === 'app') return `${base}-${deploymentId}`
    return `${base}-${appSlug}-${deploymentId}`
  },

  /**
   * Generate image name from environment and optional app slug
   */
  generateImageName: async function (environmentId, tag = 'latest', appSlug) {
    const env = await Environment.findOne({ id: environmentId }).populate(
      'project'
    )
    if (!env) return null
    const base = `slipway/${env.project.slug}-${env.slug}`
    if (!appSlug || appSlug === 'app') return `${base}:${tag}`
    return `${base}-${appSlug}:${tag}`
  }
}
