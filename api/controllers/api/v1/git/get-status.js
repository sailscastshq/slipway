/**
 * Get Git Integration Status
 */
module.exports = {
  friendlyName: 'Get Git Status',

  description: 'Get the current Git integration status.',

  inputs: {},

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId })

    // Get GitHub provider
    const githubProvider = await GitProvider.findOne({
      team: user.team,
      type: 'github',
      isActive: true
    })

    // Count connected repos
    let repoCount = 0
    if (githubProvider) {
      repoCount = await GitRepository.count({ provider: githubProvider.id })
    }

    // Count active deploy tokens
    const tokenCount = await DeployToken.count({
      team: user.team,
      isActive: true
    })

    return {
      github: {
        connected: !!githubProvider,
        repoCount
      },
      deployTokens: {
        count: tokenCount
      }
    }
  }
}
