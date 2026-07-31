module.exports = {
  friendlyName: 'Update environment',

  description: "Update an environment's details.",

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
    },
    resourceLimits: {
      type: 'json',
      description: 'Docker resource limits for the app (cpus, memory)'
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
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({
    projectSlug,
    slug,
    name,
    isProduction,
    domain,
    envVars,
    resourceLimits
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

    const environment = await Environment.findOne({ project: project.id, slug })

    if (!environment) {
      throw 'notFound'
    }

    const problems = sails.helpers.configuration.validate({
      name,
      domain,
      resourceLimits
    })
    if (problems.length) {
      throw { badRequest: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    // Build update object
    const updates = {}
    if (name !== undefined) updates.name = name
    if (isProduction !== undefined) updates.isProduction = isProduction
    if (domain !== undefined) updates.domain = domain
    if (envVars !== undefined) updates.envVars = envVars

    await Environment.updateOne({ id: environment.id }).set(updates)

    // If resource limits changed, update the App record
    if (resourceLimits !== undefined) {
      await App.update({ environment: environment.id }).set({ resourceLimits })
    }

    // If domain changed, update Caddy route
    if (domain !== undefined) {
      try {
        await sails.helpers.caddy.updateRoute(environment.id)
      } catch (err) {
        // Log but don't fail - Caddy update is best-effort
        sails.log.warn(
          'Failed to update Caddy route after domain change:',
          err.message
        )
      }
    }

    // Audit log
    await sails.helpers.audit.log.with({
      action: 'environment.updated',
      resourceType: 'environment',
      resourceId: environment.id,
      details: {
        projectSlug,
        environmentSlug: slug,
        fields: Object.keys(updates)
      },
      userId: user.id,
      teamId: project.team.id,
      ipAddress: this.req.ip
    })

    const updatedEnv = await Environment.findOne({ id: environment.id })
      .populate('app')
      .populate('services')

    return { environment: updatedEnv }
  }
}
