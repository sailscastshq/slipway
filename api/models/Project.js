/**
 * Project.js
 *
 * A project represents a deployable application (e.g. a Sails app).
 * Projects contain environments (production, staging, etc.)
 */

module.exports = {
  tableName: 'projects',

  attributes: {
    name: {
      type: 'string',
      required: true,
      description: 'Human-readable project name',
      example: 'My SaaS App'
    },

    slug: {
      type: 'string',
      required: true,
      unique: true,
      description: 'URL-safe identifier for the project',
      example: 'my-saas-app',
      regex: /^[a-z0-9-]+$/
    },

    description: {
      type: 'string',
      description: 'Optional description of the project'
    },

    repositoryUrl: {
      type: 'string',
      description: 'Git repository URL (optional)',
      columnName: 'repository_url'
    },

    dockerfilePath: {
      type: 'string',
      defaultsTo: 'Dockerfile',
      description: 'Path to Dockerfile relative to repo root',
      columnName: 'dockerfile_path'
    },

    // Associations
    team: {
      model: 'team',
      required: true
    },

    // User who created the project
    createdBy: {
      model: 'user',
      columnName: 'created_by'
    },

    environments: {
      collection: 'environment',
      via: 'project'
    }
  },

  // Generate slug from name before create
  beforeCreate: async function (values, proceed) {
    if (!values.slug && values.name) {
      values.slug = values.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    }
    return proceed()
  }
}
