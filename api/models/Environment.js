/**
 * Environment.js
 *
 * An environment is an isolated deployment context within a project.
 * Examples: production, staging, development, preview-pr-123
 */

module.exports = {
  tableName: 'environments',

  attributes: {
    name: {
      type: 'string',
      required: true,
      description: 'Environment name',
      example: 'production'
    },

    slug: {
      type: 'string',
      required: true,
      description: 'URL-safe identifier',
      example: 'production',
      regex: /^[a-z0-9-]+$/
    },

    isProduction: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Whether this is a production environment',
      columnName: 'is_production'
    },

    domain: {
      type: 'string',
      description: 'Custom domain for this environment (optional)',
      example: 'myapp.example.com'
    },

    // Associations
    project: {
      model: 'project',
      required: true
    },

    app: {
      collection: 'app',
      via: 'environment'
    },

    services: {
      collection: 'service',
      via: 'environment'
    },

    deployments: {
      collection: 'deployment',
      via: 'environment'
    }
  },

  // Compound unique: project + slug
  beforeCreate: async function (values, proceed) {
    if (!values.slug && values.name) {
      values.slug = values.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    }

    // Check uniqueness within project
    const existing = await Environment.findOne({
      project: values.project,
      slug: values.slug
    })
    if (existing) {
      return proceed(new Error(`Environment "${values.slug}" already exists in this project`))
    }

    return proceed()
  },

  /**
   * Get the full domain for this environment
   * Format: <project-slug>-<env-slug>.slipway.local
   */
  getFullDomain: async function (environmentId) {
    const env = await Environment.findOne({ id: environmentId }).populate('project')
    if (!env) return null

    if (env.domain) {
      return env.domain
    }

    const baseDomain = sails.config.custom.slipwayDomain || 'slipway.local'
    return `${env.project.slug}-${env.slug}.${baseDomain}`
  }
}
