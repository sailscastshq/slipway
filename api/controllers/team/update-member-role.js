module.exports = {
  friendlyName: 'Update member role',

  description: "Change a team member's role.",

  inputs: {
    userId: {
      type: 'string',
      required: true,
      description: 'User ID to update'
    },
    role: {
      type: 'string',
      required: true,
      isIn: ['admin', 'member'],
      description: 'New role'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    notFound: {
      statusCode: 404
    },
    invalid: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ userId, role }) {
    const currentUser = await User.findOne({ id: this.req.session.userId })

    // Only owners can change roles
    if (currentUser.teamRole !== 'owner') {
      this.req.addFlash('error', 'Only team owners can change roles.')
      return '/settings/team'
    }

    const problems = sails.helpers.setting.validate({ role }, [], this.req)
    if (problems.length) {
      throw { invalid: { problems } }
    }

    // Can't change own role
    if (userId === currentUser.id) {
      this.req.addFlash('error', 'You cannot change your own role.')
      return '/settings/team'
    }

    const targetUser = await User.findOne({
      id: userId,
      team: currentUser.team
    })

    if (!targetUser) {
      throw 'notFound'
    }

    // Can't change owner role
    if (targetUser.teamRole === 'owner') {
      this.req.addFlash('error', "Cannot change the team owner's role.")
      return '/settings/team'
    }

    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    await User.updateOne({ id: userId }).set({ teamRole: role })

    this.req.addFlash(
      'success',
      `Updated ${targetUser.fullName}'s role to ${role}.`
    )
    return '/settings/team'
  }
}
