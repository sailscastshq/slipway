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
    },
    sourceEnvironmentSlug: {
      type: 'string',
      description:
        'Optional environment whose config should be copied using preview policies'
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

  fn: async function ({
    projectSlug,
    name,
    isProduction,
    domain,
    sourceEnvironmentSlug
  }) {
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

    let inherited = { values: {}, metadata: {} }
    if (sourceEnvironmentSlug) {
      const sourceEnvironment = await Environment.findOne({
        project: project.id,
        slug: sourceEnvironmentSlug
      }).decrypt()
      if (!sourceEnvironment) throw 'notFound'
      inherited = sails.helpers.configuration.applyPreviewPolicy(
        sourceEnvironment.envVars || {},
        sourceEnvironment.envVarMetadata || {}
      )
    }

    let environment
    try {
      const { telemetryToken, telemetryTokenHash } =
        sails.helpers.environment.generateTelemetryToken()
      environment = await Environment.create({
        name,
        isProduction,
        domain,
        envVars: inherited.values,
        envVarMetadata: inherited.metadata,
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

    await sails.helpers.audit.log.with({
      action: 'environment.created',
      resourceType: 'environment',
      resourceId: String(environment.id),
      details: {
        projectSlug,
        environmentSlug: environment.slug,
        sourceEnvironmentSlug: sourceEnvironmentSlug || null,
        inheritedConfigKeys: Object.keys(inherited.values).sort()
      },
      userId: String(user.id),
      teamId: String(project.team.id),
      ipAddress: this.req.ip
    })

    return { environment }
  }
}
