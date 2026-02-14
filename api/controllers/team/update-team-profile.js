module.exports = {
  friendlyName: 'Update team profile',

  description: 'Update team name and other profile settings.',

  inputs: {
    name: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 100
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    }
  },

  fn: async function ({ name }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    // Generate new slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    await Team.updateOne({ id: user.team.id }).set({
      name,
      slug
    })

    // Flush the cached loggedInUser so sidebar updates
    sails.inertia.flushShared('loggedInUser')

    this.req._sails.inertia.flash('success', 'Team profile updated')
    return '/settings/team-profile'
  }
}
