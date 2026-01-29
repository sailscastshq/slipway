module.exports = {
  friendlyName: 'Update environment',

  description: 'Update an environment\'s details.',

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

  fn: async function ({ projectIdOrSlug, id, name, isProduction, domain }) {
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
