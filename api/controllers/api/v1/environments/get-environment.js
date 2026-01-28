module.exports = {
  friendlyName: 'Get environment',

  description: 'Get a single environment by ID or slug.',

  inputs: {
    projectId: {
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

  fn: async function ({ projectId, id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find project
    let project = await Project.findOne({ id: projectId }).populate('team')
    if (!project) {
      project = await Project.findOne({ slug: projectId }).populate('team')
    }

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Find environment
    let environment = await Environment.findOne({ id, project: project.id })
      .populate('app')
      .populate('services')
      .populate('deployments')

    if (!environment) {
      environment = await Environment.findOne({ slug: id, project: project.id })
        .populate('app')
        .populate('services')
        .populate('deployments')
    }

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
