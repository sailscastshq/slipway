/**
 * GitRepository.js
 *
 * A linked Git repository for push-to-deploy.
 */

module.exports = {
  tableName: 'git_repositories',
  attributes: {
    // Repository identifiers
    externalId: {
      type: 'string',
      columnName: 'external_id',
      required: true,
      description: 'Provider-specific repo ID (e.g., GitHub repo ID)'
    },

    fullName: {
      type: 'string',
      columnName: 'full_name',
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
      columnName: 'clone_url',
      required: true,
      description: 'SSH clone URL (e.g., git@github.com:user/repo.git)'
    },

    htmlUrl: {
      type: 'string',
      columnName: 'html_url',
      allowNull: true,
      description: 'Web URL to view repository'
    },

    defaultBranch: {
      type: 'string',
      columnName: 'default_branch',
      defaultsTo: 'main'
    },

    isPrivate: {
      type: 'boolean',
      columnName: 'is_private',
      defaultsTo: false
    },

    // Deploy key (SSH key for cloning private repos)
    deployKeyId: {
      type: 'string',
      columnName: 'deploy_key_id',
      allowNull: true,
      description: 'Provider-specific deploy key ID (for deletion)'
    },

    deployKeyPublic: {
      type: 'string',
      columnName: 'deploy_key_public',
      allowNull: true,
      description: 'SSH public key'
    },

    deployKeyPrivate: {
      type: 'string',
      columnName: 'deploy_key_private',
      allowNull: true,
      encrypt: true,
      description: 'SSH private key (encrypted)'
    },

    // Webhook configuration
    webhookId: {
      type: 'string',
      columnName: 'webhook_id',
      allowNull: true,
      description: 'Provider-specific webhook ID'
    },

    webhookSecret: {
      type: 'string',
      columnName: 'webhook_secret',
      allowNull: true,
      encrypt: true,
      description: 'Webhook signature secret'
    },

    webhookUrl: {
      type: 'string',
      columnName: 'webhook_url',
      allowNull: true
    },

    // Branch → Environment mapping
    branchMappings: {
      type: 'json',
      columnName: 'branch_mappings',
      defaultsTo: {},
      description:
        'Map branches to environments (e.g., {"main": "production", "develop": "staging"})'
    },

    // Settings
    autoDeploy: {
      type: 'boolean',
      columnName: 'auto_deploy',
      defaultsTo: true,
      description: 'Automatically deploy on push'
    },

    autoDeployPreviews: {
      type: 'boolean',
      columnName: 'auto_deploy_previews',
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
  }
}
