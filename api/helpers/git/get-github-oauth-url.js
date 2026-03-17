module.exports = {
  friendlyName: 'Get GitHub OAuth URL',

  description: 'Generate GitHub OAuth authorization URL.',

  inputs: {
    state: {
      type: 'string',
      required: true,
      description: 'Random state for CSRF protection'
    },
    redirectUri: {
      type: 'string',
      description: 'OAuth callback URL'
    }
  },

  fn: async function ({ state, redirectUri }) {
    // Check settings first, then config, then env
    const clientId =
      (await sails.helpers.setting.get('githubClientId')) ||
      sails.config.custom.github?.clientId ||
      process.env.GITHUB_CLIENT_ID

    if (!clientId) {
      throw new Error(
        'GitHub OAuth not configured. Configure it in Settings → Git Integration.'
      )
    }

    const baseUrl = 'https://github.com/login/oauth/authorize'
    const instanceUrl = await sails.helpers.getInstanceUrl()
    const callback = redirectUri || `${instanceUrl}/auth/github/callback`

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      scope: 'repo read:user',
      state
    })

    return `${baseUrl}?${params.toString()}`
  }
}
