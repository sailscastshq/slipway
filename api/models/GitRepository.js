/**
 * GitRepository.js
 *
 * A linked Git repository for push-to-deploy.
 */

module.exports = {
  attributes: {
    // Repository identifiers
    externalId: {
      type: 'string',
      required: true,
      description: 'Provider-specific repo ID (e.g., GitHub repo ID)'
    },

    fullName: {
      type: 'string',
      required: true,
      description: 'Full repository name (e.g., "user/repo")'
    },

    name: {
      type: 'string',
      required: true,
      description: 'Repository name without owner'
    },

    owner: {
      type: 'string',
      required: true,
      description: 'Repository owner (user or org)'
    },

    // URLs
    cloneUrl: {
      type: 'string',
      required: true,
      description: 'SSH clone URL (e.g., git@github.com:user/repo.git)'
    },

    htmlUrl: {
      type: 'string',
      allowNull: true,
      description: 'Web URL to view repository'
    },

    defaultBranch: {
      type: 'string',
      defaultsTo: 'main'
    },

    isPrivate: {
      type: 'boolean',
      defaultsTo: false
    },

    // Deploy key (SSH key for cloning private repos)
    deployKeyId: {
      type: 'string',
      allowNull: true,
      description: 'Provider-specific deploy key ID (for deletion)'
    },

    deployKeyPublic: {
      type: 'string',
      allowNull: true,
      description: 'SSH public key'
    },

    deployKeyPrivate: {
      type: 'string',
      allowNull: true,
      encrypt: true,
      description: 'SSH private key (encrypted)'
    },

    // Webhook configuration
    webhookId: {
      type: 'string',
      allowNull: true,
      description: 'Provider-specific webhook ID'
    },

    webhookSecret: {
      type: 'string',
      allowNull: true,
      encrypt: true,
      description: 'Webhook signature secret'
    },

    webhookUrl: {
      type: 'string',
      allowNull: true
    },

    // Branch → Environment mapping
    branchMappings: {
      type: 'json',
      defaultsTo: {},
      description: 'Map branches to environments (e.g., {"main": "production", "develop": "staging"})'
    },

    // Settings
    autoDeploy: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Automatically deploy on push'
    },

    autoDeployPreviews: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Automatically deploy PR preview environments'
    },

    // Relationships
    provider: {
      model: 'gitprovider',
      required: true
    },

    app: {
      model: 'app'
    },

    environment: {
      model: 'environment'
    }
  },

}
