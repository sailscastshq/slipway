module.exports = {
  friendlyName: 'List projects',

  description: "List all projects for the current user's team.",

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId })

    if (!user.team) {
      return { projects: [] }
    }

    const projects = await Project.find({ team: user.team })
      .populate('environments')
      .populate('createdBy')
      .sort('createdAt DESC')

    return { projects }
  }
}
