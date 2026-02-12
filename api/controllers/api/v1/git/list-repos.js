/**
 * List GitHub repositories
 */
module.exports = {
  friendlyName: 'List Repos',

  description: 'List available GitHub repositories.',

  inputs: {
    page: {
      type: 'number',
      defaultsTo: 1
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notConnected: {
      statusCode: 400
    }
  },

  fn: async function ({ page }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find GitHub provider for user's team
    const provider = await GitProvider.findOne({
      team: user.team,
      type: 'github',
      isActive: true
    })

    if (!provider || !provider.clientSecret) {
      throw { notConnected: { message: 'GitHub not connected' } }
    }

    // Get repos from GitHub
    const repos = await sails.helpers.git.listGithubRepos(
      provider.clientSecret,
      page
    )

    // Mark repos that are already connected
    const connectedRepos = await GitRepository.find({
      provider: provider.id
    }).select(['externalId'])

    const connectedIds = new Set(connectedRepos.map(r => r.externalId))

    return {
      repos: repos.map(repo => ({
        ...repo,
        isConnected: connectedIds.has(repo.id)
      })),
      page,
      hasMore: repos.length === 30
    }
  }
}
