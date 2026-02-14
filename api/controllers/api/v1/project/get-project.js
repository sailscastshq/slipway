module.exports = {
  friendlyName: 'Get project',

  description: 'Get a single project by slug.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404,
      description: 'Project not found'
    },
    forbidden: {
      statusCode: 403,
      description: 'Not authorized to access this project'
    }
  },

  fn: async function ({ slug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug })
      .populate('environments')
      .populate('createdBy')
      .populate('team')

    if (!project) {
      throw 'notFound'
    }

    // Check user has access to this project's team
    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    return { project }
  }
}
