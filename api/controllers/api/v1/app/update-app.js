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
    })
    if (!app) throw 'notFound'

    const problems = sails.helpers.configuration.validate({
      name,
      dockerfilePath,
      routePath,
      healthPath,
      resourceLimits
    })
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
    if (envVars !== undefined) updates.envVars = envVars
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

    return { app: updated }
  }
}
