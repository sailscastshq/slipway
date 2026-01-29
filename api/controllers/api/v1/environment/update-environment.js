module.exports = {
  friendlyName: 'Update environment',

  description: 'Update an environment\'s details.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    slug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
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
    },
    envVars: {
      type: 'json',
      description: 'Environment variables (key-value object)'
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

  fn: async function ({ projectSlug, slug, name, isProduction, domain, envVars }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({ project: project.id, slug })

    if (!environment) {
      throw 'notFound'
    }

    // Build update object
    const updates = {}
    if (name !== undefined) updates.name = name
    if (isProduction !== undefined) updates.isProduction = isProduction
    if (domain !== undefined) updates.domain = domain
    if (envVars !== undefined) updates.envVars = envVars

    await Environment.updateOne({ id: environment.id }).set(updates)

    const updatedEnv = await Environment.findOne({ id: environment.id })
      .populate('app')
      .populate('services')

    return { environment: updatedEnv }
  }
}
