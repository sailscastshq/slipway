module.exports = {
  friendlyName: 'Get project',

  description: 'Get a single project by ID or slug.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
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

  fn: async function ({ id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Try to find by ID first, then by slug
    let project = await Project.findOne(id)
      .populate('environments')
      .populate('createdBy')
      .populate('team')

    if (!project) {
      project = await Project.findOne({ slug: id })
        .populate('environments')
        .populate('createdBy')
        .populate('team')
    }

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
