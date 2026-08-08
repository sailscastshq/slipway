const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Update app',

  description:
    'Update app settings (name, dockerfilePath, routePath, healthPath, envVars, resourceLimits).',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    appSlug: {
      type: 'string',
      required: true
    },
    name: {
      type: 'string'
    },
    dockerfilePath: {
      type: 'string'
    },
    routePath: {
      type: 'string',
      allowNull: true
    },
    healthPath: {
      type: 'string'
    },
    envVars: {
      type: 'json'
    },
    envVarMetadata: {
      type: 'json'
    },
    resourceLimits: {
      type: 'json'
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' },
    precognitionSuccess: { responseType: 'precognitionSuccess' }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    appSlug,
    name,
    dockerfilePath,
    routePath,
    healthPath,
    envVars,
    envVarMetadata,
    resourceLimits
  }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )
    if (!project || project.team.id !== user.team) throw 'notFound'

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    const app = await App.findOne({
      environment: environment.id,
      slug: appSlug
    }).decrypt()
    if (!app) throw 'notFound'

    const problems = sails.helpers.configuration.validate({
      name,
      dockerfilePath,
      routePath,
      healthPath,
      resourceLimits
    })
    const currentEnvVars = app.secureEnvVars || app.envVars || {}
    const nextEnvVars = envVars === undefined ? currentEnvVars : envVars
    if (envVars !== undefined || envVarMetadata !== undefined) {
      const managedKeys = (await Service.find({ environment: environment.id }))
        .map((service) => service.envVarKey)
        .filter(Boolean)
      for (const key of managedKeys) {
        if (Object.prototype.hasOwnProperty.call(nextEnvVars, key)) {
          problems.push({
            envVars: `"${key}" is managed by Slipway at the environment scope and cannot be overridden by an app.`
          })
          break
        }
      }
      problems.push(
        ...sails.helpers.configuration.validateEnvVarMetadata(
          nextEnvVars,
          envVarMetadata || app.envVarMetadata || {}
        )
      )
    }
    if (problems.length) {
      throw { badRequest: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    const updates = {}
    if (name !== undefined) updates.name = name
    if (dockerfilePath !== undefined) updates.dockerfilePath = dockerfilePath
    if (routePath !== undefined) updates.routePath = routePath
    if (healthPath !== undefined) updates.healthPath = healthPath
    let normalizedMetadata = app.envVarMetadata || {}
    if (envVars !== undefined || envVarMetadata !== undefined) {
      normalizedMetadata =
        sails.helpers.configuration.normalizeEnvVarMetadata.with({
          values: nextEnvVars,
          metadata: envVarMetadata || app.envVarMetadata || {},
          currentValues: currentEnvVars,
          currentMetadata: app.envVarMetadata || {},
          changedBy: String(user.id),
          changedByName: user.fullName
        })
      updates.secureEnvVars = nextEnvVars
      updates.envVars = {}
      updates.envVarMetadata = normalizedMetadata
    }
    if (resourceLimits !== undefined) {
      updates.resourceLimits = resourceLimits

      // Apply to running container via docker update (no restart needed)
      if (app.status === 'running' && app.containerName) {
        try {
          const dockerPath = sails.config.docker?.binaryPath || 'docker'
          const args = ['update']
          if (resourceLimits.cpus)
            args.push('--cpus', String(resourceLimits.cpus))
          if (resourceLimits.memory) {
            args.push('--memory', String(resourceLimits.memory))
            args.push('--memory-swap', '-1')
          }
          args.push(app.containerName)

          await execFileAsync(dockerPath, args)
          sails.log.info(
            `Applied resource limits to app ${app.containerName}: cpus=${resourceLimits.cpus}, memory=${resourceLimits.memory}`
          )
        } catch (err) {
          sails.log.warn(
            `Could not apply resource limits to ${app.containerName}: ${err.message}`
          )
          // Limits are saved to DB — they'll apply on next deploy
        }
      }
    }

    const updated = await App.updateOne({ id: app.id }).set(updates)

    if (envVars !== undefined || envVarMetadata !== undefined) {
      await sails.helpers.configuration.recordEnvVarChanges.with({
        before: currentEnvVars,
        after: nextEnvVars,
        beforeMetadata: app.envVarMetadata || {},
        afterMetadata: normalizedMetadata,
        scope: 'app',
        resourceType: 'app',
        resourceId: String(app.id),
        userId: String(user.id),
        teamId: String(project.team.id),
        ipAddress: this.req.ip
      })
    }

    const {
      envVars: legacyEnvVars,
      secureEnvVars,
      bridgeSecret,
      bearingSecret,
      ...publicApp
    } = updated
    return { app: publicApp }
  }
}
