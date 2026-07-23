module.exports = {
  friendlyName: 'Delete team logo',

  description: 'Remove the team logo.',

  exits: {
    success: {
      responseType: 'inertiaRedirect',
      description: 'Logo removed.'
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    await Team.updateOne({ id: user.team.id }).set({
      logoUrl: ''
    })

    sails.inertia.refreshOnce('loggedInUser')
    sails.inertia.flash('success', 'Team logo removed.')
    return '/settings/team-profile'
  }
}
