module.exports = {
  friendlyName: 'List Branches',

  description: 'List branches for a GitHub repository.',

  inputs: {
    owner: {
      type: 'string',
      required: true
    },
    repo: {
      type: 'string',
      required: true
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

  fn: async function ({ owner, repo }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const provider = await GitProvider.findOne({
      team: user.team,
      type: 'github',
      isActive: true
    }).decrypt()

    if (!provider || !provider.clientSecret) {
      throw { notConnected: { message: 'GitHub not connected' } }
    }

    const branches = await sails.helpers.git.listGithubBranches(
      provider.clientSecret,
      owner,
      repo
    )

    return { branches }
  }
}
