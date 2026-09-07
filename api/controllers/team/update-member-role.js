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
      responseType: 'inertiaRedirect'
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
    const currentUser = await User.forRequest(this.req)

    // Only owners can change roles
    if (currentUser.teamRole !== 'owner') {
      sails.inertia.flash('error', 'Only team owners can change roles.')
      return '/settings/team'
    }

    const problems = sails.helpers.setting.validate({ role }, [], this.req)
    if (problems.length) {
      throw { invalid: { problems } }
    }

    // Can't change own role
    if (Number(userId) === Number(currentUser.id)) {
      sails.inertia.flash('error', 'You cannot change your own role.')
      return '/settings/team'
    }

    const membership = await TeamMembership.findOne({
      user: userId,
      team: currentUser.team
    }).populate('user')
    const targetUser = membership?.user
      ? { ...membership.user, teamRole: membership.role }
      : null

    if (!targetUser) {
      throw 'notFound'
    }

    // Can't change owner role
    if (targetUser.teamRole === 'owner') {
      sails.inertia.flash('error', "Cannot change the team owner's role.")
      return '/settings/team'
    }

    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    await TeamMembership.updateOne({ id: membership.id }).set({ role })
    sails.sse?.revoke?.({ userId })

    sails.inertia.flash(
      'success',
      `Updated ${targetUser.fullName}'s role to ${role}.`
    )
    return '/settings/team'
  }
}
