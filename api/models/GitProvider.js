/**
 * GitProvider.js
 *
 * A Git provider configuration (GitHub, GitLab, Bitbucket, or self-hosted).
 */

module.exports = {
  tableName: 'git_providers',
  attributes: {
    // Provider type
    type: {
      type: 'string',
      isIn: ['github', 'gitlab', 'bitbucket', 'gitea', 'custom'],
      required: true
    },

    // Display name
    name: {
      type: 'string',
      required: true
    },

    // OAuth credentials
    clientId: {
      type: 'string',
      columnName: 'client_id',
      allowNull: true
    },

    clientSecret: {
      type: 'string',
      columnName: 'client_secret',
      allowNull: true,
      encrypt: true
    },

    // For GitHub App (alternative to OAuth)
    appId: {
      type: 'string',
      columnName: 'app_id',
      allowNull: true
    },

    privateKey: {
      type: 'string',
      columnName: 'private_key',
      allowNull: true,
      encrypt: true
    },

    installationId: {
      type: 'string',
      columnName: 'installation_id',
      allowNull: true
    },

    // For self-hosted instances
    apiUrl: {
      type: 'string',
      columnName: 'api_url',
      allowNull: true,
      description:
        'API URL for self-hosted Git (e.g., https://gitlab.company.com/api/v4)'
    },

    baseUrl: {
      type: 'string',
      columnName: 'base_url',
      allowNull: true,
      description:
        'Base URL for self-hosted Git (e.g., https://gitlab.company.com)'
    },

    // Status
    isActive: {
      type: 'boolean',
      columnName: 'is_active',
      defaultsTo: true
    },

    // Relationships
    team: {
      model: 'team'
    },

    repositories: {
      collection: 'gitrepository',
      via: 'provider'
    }
  },

  // Get default API URL for provider type
  getApiUrl: function (provider) {
    if (provider.apiUrl) return provider.apiUrl

    switch (provider.type) {
      case 'github':
        return 'https://api.github.com'
      case 'gitlab':
        return 'https://gitlab.com/api/v4'
      case 'bitbucket':
        return 'https://api.bitbucket.org/2.0'
      default:
        return provider.apiUrl
    }
  }
}
