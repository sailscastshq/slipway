module.exports = {
  friendlyName: 'Create environment',

  description: 'Create a new environment within a project.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    name: {
      type: 'string',
      required: true,
      maxLength: 120,
      description: 'Environment name'
    },
    isProduction: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Whether this is a production environment'
    },
    domain: {
      type: 'string',
      description: 'Custom domain for this environment'
    }
  },

  exits: {
    success: {
      statusCode: 201
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

  fn: async function ({ projectSlug, name, isProduction, domain }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    let environment
    try {
      const { telemetryToken, telemetryTokenHash } =
        sails.helpers.environment.generateTelemetryToken()
      environment = await Environment.create({
        name,
        isProduction,
        domain,
        telemetryToken,
        telemetryTokenHash,
        project: project.id
      }).fetch()
    } catch (error) {
      if (error.message && error.message.includes('already exists')) {
        throw {
          badRequest: {
            problems: [
              {
                name: 'An environment with this name already exists in this project.'
              }
            ]
          }
        }
      }
      throw error
    }

    return { environment }
  }
}
