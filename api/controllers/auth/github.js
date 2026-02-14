/**
 * GitHub OAuth initiation
 */
module.exports = {
  friendlyName: 'GitHub OAuth',

  description: 'Initiate GitHub OAuth flow.',

  inputs: {
    returnTo: {
      type: 'string',
      description: 'URL to return to after OAuth'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ returnTo }) {
    // Generate random state for CSRF protection
    const state = await sails.helpers.strings.random('url-friendly')

    // Store state and return URL in session
    this.req.session.githubOAuthState = state
    this.req.session.githubReturnTo = returnTo || '/settings/git'

    // Get OAuth URL
    const authUrl = await sails.helpers.git.getGithubOauthUrl(state)

    return authUrl
  }
}
