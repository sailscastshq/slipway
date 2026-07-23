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
      responseType: 'inertiaRedirect'
    },
    invalid: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ teamId }) {
    const userId = this.req.session.userId

    // Check if user is a member of the target team or owns it
    const team = await Team.findOne({ id: teamId })
    if (!team) {
      throw {
        invalid: {
          problems: [{ teamId: 'That team is no longer available.' }]
        }
      }
    }

    // Check if user is owner or member
    const isOwner = team.owner === userId
    const isMember = await User.findOne({ id: userId, team: teamId })

    if (!isOwner && !isMember) {
      throw {
        invalid: {
          problems: [{ teamId: 'You do not have access to that team.' }]
        }
      }
    }

    // Update user's current team
    await User.updateOne({ id: userId }).set({ team: teamId })

    sails.inertia.refreshOnce('loggedInUser')
    sails.inertia.flash('success', `Switched to ${team.name}.`)
    return '/'
  }
}
