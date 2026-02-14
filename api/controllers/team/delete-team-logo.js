module.exports = {
  friendlyName: 'Delete team logo',

  description: 'Remove the team logo.',

  exits: {
    success: {
      description: 'Logo removed.'
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    await Team.updateOne({ id: user.team.id }).set({
      logoUrl: null
    })

    return { success: true }
  }
}
