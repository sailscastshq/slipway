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
      description: 'URL-safe identifier, auto-generated from name if not provided',
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

    envVars: {
      type: 'json',
      defaultsTo: {},
      description: 'Environment variables passed to containers at deploy time',
      columnName: 'env_vars'
    },

    /**
     * Detected Sails features in the deployed app.
     * Populated during deployment by analyzing package.json.
     */
    features: {
      type: 'json',
      defaultsTo: {},
      description: 'Detected Sails features (e.g., sails-content, sails-quest)',
      example: {
        'sails-content': { version: '^1.0.0', contentDir: 'content' },
        'sails-quest': { version: '^1.0.0' }
      }
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
   *
   * Domain resolution tiers:
   * 1. Custom domain (env.domain) — e.g. myapp.example.com
   * 2. Wildcard subdomain (wildcardDomain setting) — e.g. myapp-prod.example.com
   * 3. slipwayDomain from config — e.g. myapp-prod.localhost
   */
  getFullDomain: async function (environmentId) {
    const env = await Environment.findOne({ id: environmentId }).populate('project')
    if (!env) return null

    // 1. Custom domain set on this environment
    if (env.domain) {
      return env.domain
    }

    const subdomain = `${env.project.slug}-${env.slug}`

    // 2. Wildcard domain configured (e.g. example.com → myapp-prod.example.com)
    const wildcardDomain = await sails.helpers.setting.get('wildcardDomain')
    if (wildcardDomain) {
      return `${subdomain}.${wildcardDomain}`
    }

    // 3. slipwayDomain from config (e.g. localhost → myapp-prod.localhost)
    const slipwayDomain = sails.config.custom.slipwayDomain
    if (slipwayDomain) {
      return `${subdomain}.${slipwayDomain}`
    }

    return null
  }
}
