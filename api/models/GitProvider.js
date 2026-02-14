/**
 * GitProvider.js
 *
 * A Git provider configuration (GitHub, GitLab, Bitbucket, or self-hosted).
 */

module.exports = {
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
      allowNull: true
    },

    clientSecret: {
      type: 'string',
      allowNull: true,
      encrypt: true
    },

    // For GitHub App (alternative to OAuth)
    appId: {
      type: 'string',
      allowNull: true
    },

    privateKey: {
      type: 'string',
      allowNull: true,
      encrypt: true
    },

    installationId: {
      type: 'string',
      allowNull: true
    },

    // For self-hosted instances
    apiUrl: {
      type: 'string',
      allowNull: true,
      description: 'API URL for self-hosted Git (e.g., https://gitlab.company.com/api/v4)'
    },

    baseUrl: {
      type: 'string',
      allowNull: true,
      description: 'Base URL for self-hosted Git (e.g., https://gitlab.company.com)'
    },

    // Status
    isActive: {
      type: 'boolean',
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
