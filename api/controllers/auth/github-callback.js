/**
 * GitHub OAuth callback
 */
module.exports = {
  friendlyName: 'GitHub OAuth Callback',

  description: 'Handle GitHub OAuth callback.',

  inputs: {
    code: {
      type: 'string',
      required: true
    },
    state: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    invalidState: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ code, state }) {
    const user = await User.findOne({ id: this.req.session.userId })
    if (!user) {
      return '/login'
    }

    // Verify state
    if (state !== this.req.session.githubOAuthState) {
      sails.log.warn('GitHub OAuth state mismatch')
      delete this.req.session.githubOAuthState
      return '/settings/git?error=invalid_state'
    }

    delete this.req.session.githubOAuthState

    try {
      // Exchange code for token
      const { accessToken } = await sails.helpers.git.exchangeGithubCode(code)

      // Get GitHub user info
      const githubUser = await sails.helpers.git.getGithubUser(accessToken)

      // Find or create GitProvider for this team
      let provider = await GitProvider.findOne({
        team: user.team,
        type: 'github'
      })

      if (provider) {
        // Update existing provider
        await GitProvider.updateOne({ id: provider.id }).set({
          name: `GitHub (${githubUser.login})`,
          // Note: We store the user's access token encrypted
          // In production, consider using GitHub App instead
          clientSecret: accessToken,
          isActive: true
        })
      } else {
        // Create new provider
        provider = await GitProvider.create({
          type: 'github',
          name: `GitHub (${githubUser.login})`,
          clientSecret: accessToken,
          team: user.team,
          isActive: true
        }).fetch()
      }

      // Store provider ID in session for repo selection
      this.req.session.githubProviderId = provider.id

      const returnTo = this.req.session.githubReturnTo || '/settings/git'
      delete this.req.session.githubReturnTo

      return `${returnTo}?connected=github`
    } catch (err) {
      sails.log.error('GitHub OAuth error:', err)
      return '/settings/git?error=oauth_failed'
    }
  }
}
