module.exports = {
  friendlyName: 'Switch team',

  description: 'Switch the current user to a different team.',

  inputs: {
    teamId: {
      type: 'number',
      required: true,
      description: 'The ID of the team to switch to'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ teamId }) {
    const userId = this.req.session.userId

    // Check if user is a member of the target team or owns it
    const team = await Team.findOne({ id: teamId })
    if (!team) {
      throw 'notFound'
    }

    // Check if user is owner or member
    const isOwner = team.owner === userId
    const isMember = await User.findOne({ id: userId, team: teamId })

    if (!isOwner && !isMember) {
      throw 'forbidden'
    }

    // Update user's current team
    await User.updateOne({ id: userId }).set({ team: teamId })

    return { success: true }
  }
}
