module.exports = {
  friendlyName: 'Update environment',

  description: 'Update an environment\'s details.',

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
    },
    name: {
      type: 'string',
      maxLength: 120,
      description: 'Environment name'
    },
    isProduction: {
      type: 'boolean',
      description: 'Whether this is a production environment'
    },
    domain: {
      type: 'string',
      description: 'Custom domain for this environment'
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
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectId, id, name, isProduction, domain }) {
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
    if (!environment) {
      environment = await Environment.findOne({ slug: id, project: project.id })
    }

    if (!environment) {
      throw 'notFound'
    }

    // Build update object
    const updates = {}
    if (name !== undefined) updates.name = name
    if (isProduction !== undefined) updates.isProduction = isProduction
    if (domain !== undefined) updates.domain = domain

    await Environment.updateOne({ id: environment.id }).set(updates)

    const updatedEnv = await Environment.findOne({ id: environment.id })
      .populate('app')
      .populate('services')

    return { environment: updatedEnv }
  }
}
