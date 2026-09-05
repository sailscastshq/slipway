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
    envVarMetadata: {
      type: 'json',
      description: 'Non-secret type and preview metadata keyed by variable name'
    },
    resourceLimits: {
      type: 'json',
      description: 'Docker resource limits for the app (cpus, memory)'
    }
  },

  exits: {
    routeFailed: { statusCode: 503 },
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
    envVarMetadata,
    resourceLimits
  }) {
    const user = await User.findOne({
      id: this.req.auth?.userId || this.req.session.userId
    })

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug
    }).decrypt()

    if (!environment) {
      throw 'notFound'
    }

    const problems = sails.helpers.configuration.validate({
      name,
      domain,
      resourceLimits
    })
    const nextEnvVars =
      envVars === undefined ? environment.envVars || {} : envVars
    if (envVars !== undefined || envVarMetadata !== undefined) {
      problems.push(
        ...sails.helpers.configuration.validateEnvVarMetadata(
          nextEnvVars,
          envVarMetadata || environment.envVarMetadata || {}
        )
      )
    }

    const services = await Service.find({ environment: environment.id })
    const managedKeys = services
      .map((service) => service.envVarKey)
      .filter(Boolean)
    const currentEnvVarMetadata =
      sails.helpers.configuration.normalizeEnvVarMetadata.with({
        values: environment.envVars || {},
        metadata: environment.envVarMetadata || {},
        currentValues: environment.envVars || {},
        currentMetadata: environment.envVarMetadata || {},
        managedKeys,
        recordChanges: false
      })
    const requestedEnvVarMetadata =
      sails.helpers.configuration.normalizeEnvVarMetadata.with({
        values: nextEnvVars,
        metadata: envVarMetadata || currentEnvVarMetadata,
        currentValues: environment.envVars || {},
        currentMetadata: currentEnvVarMetadata,
        managedKeys,
        recordChanges: false
      })
    if (envVars !== undefined) {
      for (const key of managedKeys) {
        if (envVars[key] !== (environment.envVars || {})[key]) {
          problems.push({
            envVars: `"${key}" is managed by Slipway. Change or remove its service instead.`
          })
          break
        }
      }
    }
    if (envVarMetadata !== undefined) {
      for (const key of managedKeys) {
        const previous = currentEnvVarMetadata[key] || {}
        const requested = requestedEnvVarMetadata[key]
        if (!requested) continue
        const changed = ['kind', 'previewPolicy', 'description'].some(
          (field) => requested[field] !== previous[field]
        )
        if (changed) {
          problems.push({
            envVarMetadata: `"${key}" is managed by Slipway. Its policy cannot be changed directly.`
          })
          break
        }
      }
    }
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
    let normalizedMetadata = currentEnvVarMetadata
    if (envVars !== undefined || envVarMetadata !== undefined) {
      normalizedMetadata =
        sails.helpers.configuration.normalizeEnvVarMetadata.with({
          values: nextEnvVars,
          metadata: requestedEnvVarMetadata,
          currentValues: environment.envVars || {},
          currentMetadata: currentEnvVarMetadata,
          managedKeys,
          changedBy: String(user.id),
          changedByName: user.fullName
        })
      updates.envVars = nextEnvVars
      updates.envVarMetadata = normalizedMetadata
    }

    let route
    try {
      if (domain !== undefined)
        route = await sails.helpers.caddy.updateRoute.with({
          environmentId: String(environment.id),
          domainOverride: domain,
          deferCommit: true
        })
      await Environment.updateOne({ id: environment.id }).set(updates)
      if (route?.transaction)
        await sails.helpers.caddy.finishRouteUpdate.with({
          action: 'commit',
          transaction: route.transaction
        })
    } catch (error) {
      if (route?.transaction) {
        await Environment.updateOne({ id: environment.id }).set(
          Object.fromEntries(
            Object.keys(updates).map((key) => [key, environment[key]])
          )
        )
        // The route commit helper restores the previous candidate on failure.
        await sails.helpers.caddy.finishRouteUpdate
          .with({ action: 'rollback', transaction: route.transaction })
          .catch((rollback) => {
            error.rollbackError = rollback
          })
      }
      sails.log.warn('Environment route update failed:', error.message || error)
      throw {
        routeFailed: {
          message: error.rollbackError
            ? 'Route update and recovery failed. Check the proxy before retrying.'
            : 'The proxy could not apply this change. Previous settings were preserved. Check Caddy and retry.'
        }
      }
    }

    if (envVars !== undefined || envVarMetadata !== undefined) {
      await sails.helpers.configuration.recordEnvVarChanges.with({
        before: environment.envVars || {},
        after: nextEnvVars,
        beforeMetadata: currentEnvVarMetadata,
        afterMetadata: normalizedMetadata,
        scope: 'environment',
        resourceType: 'environment',
        resourceId: String(environment.id),
        userId: String(user.id),
        teamId: String(project.team.id),
        ipAddress: this.req.ip
      })
    }

    // If resource limits changed, update the App record
    if (resourceLimits !== undefined) {
      await App.update({ environment: environment.id }).set({ resourceLimits })
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

    const {
      envVars: privateEnvVars,
      telemetryToken,
      ...publicEnvironment
    } = updatedEnv
    return { environment: publicEnvironment }
  }
}
