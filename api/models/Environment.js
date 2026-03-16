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

    isPreview: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Whether this is an auto-created preview environment (from a PR)',
      columnName: 'is_preview'
    },

    prNumber: {
      type: 'number',
      allowNull: true,
      description: 'Pull request number (for preview environments)',
      columnName: 'pr_number'
    },

    domain: {
      type: 'string',
      description: 'Custom domain for this environment (optional)',
      example: 'myapp.example.com'
    },

    envVars: {
      type: 'json',
      encrypt: true,
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

    /**
     * Telemetry token for authenticating data from sails-hook-slipway.
     * Auto-generated on environment creation. Used as Bearer token
     * for the POST /api/v1/telemetry/ingest endpoint.
     */
    telemetryToken: {
      type: 'string',
      encrypt: true,
      description: 'Token for authenticating telemetry data from deployed apps',
      columnName: 'telemetry_token'
    },

    telemetryTokenHash: {
      type: 'string',
      allowNull: true,
      description: 'SHA-256 hash of telemetryToken for lookups',
      columnName: 'telemetry_token_hash'
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
   * Resolve the primary, generated, and fallback domains for this environment.
   */
  resolveDomains: async function (environmentId) {
    const env = await Environment.findOne({ id: environmentId }).populate('project')
    if (!env) {
      return {
        fullDomain: null,
        generatedDomain: null,
        domains: []
      }
    }

    const domains = []
    let generatedDomain = null

    if (env.domain) {
      domains.push(env.domain)
    }

    const subdomain = `${env.project.slug}-${env.slug}`

    const wildcardDomain = await sails.helpers.setting.get('wildcardDomain')
    if (wildcardDomain) {
      generatedDomain = `${subdomain}.${wildcardDomain}`
    } else {
      const slipwayDomain = sails.config.custom.slipwayDomain
      if (slipwayDomain) {
        generatedDomain = `${subdomain}.${slipwayDomain}`
      }
    }

    if (generatedDomain && !domains.includes(generatedDomain)) {
      domains.push(generatedDomain)
    }

    return {
      fullDomain: domains[0] || null,
      generatedDomain,
      domains
    }
  },

  /**
   * Get the full domain for this environment.
   *
   * Domain resolution tiers:
   * 1. Custom domain (env.domain) — e.g. myapp.example.com
   * 2. Wildcard subdomain (wildcardDomain setting) — e.g. myapp-prod.example.com
   * 3. slipwayDomain from config — e.g. myapp-prod.localhost
   */
  getFullDomain: async function (environmentId) {
    const { fullDomain } = await Environment.resolveDomains(environmentId)
    return fullDomain
  },

  getGeneratedDomain: async function (environmentId) {
    const { generatedDomain } = await Environment.resolveDomains(environmentId)
    return generatedDomain
  },

  getDomains: async function (environmentId) {
    const { domains } = await Environment.resolveDomains(environmentId)
    return domains
  }
}
