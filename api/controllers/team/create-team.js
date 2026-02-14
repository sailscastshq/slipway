module.exports = {
  friendlyName: 'Create team',

  description: 'Create a new team and switch to it.',

  inputs: {
    name: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 50,
      description: 'The name of the team'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    invalid: {
      statusCode: 400
    }
  },

  fn: async function ({ name }) {
    const userId = this.req.session.userId

    // Create the new team with the current user as owner
    const team = await Team.create({
      name: name.trim(),
      owner: userId
    }).fetch()

    // Switch the user to the new team
    await User.updateOne({ id: userId }).set({ team: team.id })

    // Clear Inertia cache to refresh loggedInUser
    this.req._sails.inertia.flushShared('loggedInUser')

    return '/'
  }
}
