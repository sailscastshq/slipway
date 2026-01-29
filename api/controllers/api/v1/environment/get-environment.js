module.exports = {
  friendlyName: 'Get environment',

  description: 'Get a single environment by ID or slug.',

  inputs: {
    projectIdOrSlug: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
    },
    id: {
      type: 'string',
      required: true,
      description: 'Environment ID or slug'
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

  fn: async function ({ projectIdOrSlug, id }) {
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

    // Find environment by ID or slug
    const environment = await Environment.findOne({
      project: project.id,
      or: [{ id }, { slug: id }]
    })
      .populate('app')
      .populate('services')
      .populate('deployments')

    if (!environment) {
      throw 'notFound'
    }

    // Get full domain
    const fullDomain = await Environment.getFullDomain(environment.id)

    return {
      environment: {
        ...environment,
        fullDomain
      }
    }
  }
}
