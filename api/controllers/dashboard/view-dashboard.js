module.exports = {
  friendlyName: 'View dashboard',

  description: 'Display "Dashboard" page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    // Get the logged-in user with their team
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    // Fetch projects for the user's team
    let projects = []
    if (user && user.team) {
      projects = await Project.find({ team: user.team.id }).sort('createdAt DESC')
    }

    return {
      page: 'dashboard/index',
      props: {
        projects
      }
    }
  }
}
