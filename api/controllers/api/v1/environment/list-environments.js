module.exports = {
  friendlyName: 'List environments',

  description: 'List all environments for a project.',

  inputs: {
    projectIdOrSlug: {
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
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ projectIdOrSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find project by ID or slug
    const project = await Project.findOne({
      or: [{ id: projectIdOrSlug }, { slug: projectIdOrSlug }]
    }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environments = await Environment.find({ project: project.id })
      .populate('app')
      .populate('services')
      .sort('createdAt ASC')

    return { environments }
  }
}
