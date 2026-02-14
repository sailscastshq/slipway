module.exports = {
  friendlyName: 'Exchange GitHub Code',

  description: 'Exchange OAuth authorization code for access token.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'Authorization code from GitHub callback'
    },
    redirectUri: {
      type: 'string',
      description: 'OAuth callback URL (must match authorization request)'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    invalidCode: {
      description: 'The authorization code was invalid or expired'
    }
  },

  fn: async function ({ code, redirectUri }) {
    // Check settings first, then config, then env
    const clientId = await sails.helpers.setting.get('githubClientId') ||
      sails.config.custom.github?.clientId ||
      process.env.GITHUB_CLIENT_ID
    const clientSecret = await sails.helpers.setting.get('githubClientSecret') ||
      sails.config.custom.github?.clientSecret ||
      process.env.GITHUB_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      throw new Error('GitHub OAuth not configured. Configure it in Settings → Git Integration.')
    }

    const callback = redirectUri || `${sails.config.custom.baseUrl}/auth/github/callback`

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callback
      })
    })

    const data = await response.json()

    if (data.error) {
      sails.log.warn(`GitHub OAuth error: ${data.error_description}`)
      throw 'invalidCode'
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      scope: data.scope
    }
  }
}
