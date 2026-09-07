module.exports = {
  friendlyName: 'Remove member',

  description: 'Remove a member from the team.',

  inputs: {
    userId: {
      type: 'string',
      required: true,
      description: 'User ID to remove'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    notFound: {
      statusCode: 404
    }
  },

  fn: async function ({ userId }) {
    const currentUser = await User.forRequest(this.req)

    // Only owners and admins can remove members
    if (!['owner', 'admin'].includes(currentUser.teamRole)) {
      sails.inertia.flash(
        'error',
        "You don't have permission to remove members."
      )
      return '/settings/team'
    }

    // Can't remove yourself
    if (Number(userId) === Number(currentUser.id)) {
      sails.inertia.flash('error', 'You cannot remove yourself from the team.')
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

    // Can't remove the owner
    if (targetUser.teamRole === 'owner') {
      sails.inertia.flash('error', 'Cannot remove the team owner.')
      return '/settings/team'
    }

    // Admins can't remove other admins
    if (currentUser.teamRole === 'admin' && targetUser.teamRole === 'admin') {
      sails.inertia.flash(
        'error',
        'Admins cannot remove other admins. Ask the team owner.'
      )
      return '/settings/team'
    }

    await TeamMembership.destroyOne({ id: membership.id })
    const tokens = await CliToken.find({ user: userId, team: currentUser.team })
    await CliToken.destroy({ user: userId, team: currentUser.team })
    for (const token of tokens) sails.sse?.revoke?.({ tokenId: token.id })
    // Clear only the legacy default, retaining the account and other memberships.
    await User.updateOne({ id: userId, team: currentUser.team }).set({
      team: null,
      teamRole: 'member'
    })
    sails.sse?.revoke?.({ userId })

    sails.inertia.flash(
      'success',
      `Removed ${targetUser.fullName} from the team.`
    )
    return '/settings/team'
  }
}
