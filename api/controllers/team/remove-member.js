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
      responseType: 'redirect'
    },
    notFound: {
      statusCode: 404
    }
  },

  fn: async function ({ userId }) {
    const currentUser = await User.findOne({ id: this.req.session.userId })

    // Only owners and admins can remove members
    if (!['owner', 'admin'].includes(currentUser.teamRole)) {
      this.req.addFlash('error', "You don't have permission to remove members.")
      return '/settings/team'
    }

    // Can't remove yourself
    if (userId === currentUser.id) {
      this.req.addFlash('error', 'You cannot remove yourself from the team.')
      return '/settings/team'
    }

    const targetUser = await User.findOne({
      id: userId,
      team: currentUser.team
    })

    if (!targetUser) {
      throw 'notFound'
    }

    // Can't remove the owner
    if (targetUser.teamRole === 'owner') {
      this.req.addFlash('error', 'Cannot remove the team owner.')
      return '/settings/team'
    }

    // Admins can't remove other admins
    if (currentUser.teamRole === 'admin' && targetUser.teamRole === 'admin') {
      this.req.addFlash(
        'error',
        'Admins cannot remove other admins. Ask the team owner.'
      )
      return '/settings/team'
    }

    // Remove user from team (nullify team association) and destroy their CLI tokens
    await CliToken.destroy({ user: userId })
    await User.destroyOne({ id: userId })

    this.req.addFlash(
      'success',
      `Removed ${targetUser.fullName} from the team.`
    )
    return '/settings/team'
  }
}
