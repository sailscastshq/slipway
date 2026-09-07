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
    const userId = this.req.auth?.userId || this.req.session.userId

    // Check if user is a member of the target team or owns it
    const team = await Team.findOne({ id: teamId })
    if (!team) {
      throw {
        invalid: {
          problems: [{ teamId: 'That team is no longer available.' }]
        }
      }
    }

    const membership = await TeamMembership.findOne({
      user: userId,
      team: teamId
    })
    if (!membership)
      throw {
        invalid: {
          problems: [{ teamId: 'You do not have access to that team.' }]
        }
      }
    if (membership.status === 'invited')
      await TeamMembership.updateOne({ id: membership.id }).set({
        status: 'active'
      })
    this.req.session.activeTeamId = teamId
    if (this.req.auth) this.req.auth.teamId = teamId
    sails.sse?.revoke?.({ sessionId: this.req.sessionID })

    sails.inertia.refreshOnce('loggedInUser')
    sails.inertia.flash('success', `Switched to ${team.name}.`)
    return '/'
  }
}
