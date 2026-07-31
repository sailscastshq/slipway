const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Update service',

  description: 'Update service display name or resource limits.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service ID'
    },
    name: {
      type: 'string',
      description: 'New display name for the service'
    },
    resourceLimits: {
      type: 'json',
      description: 'Docker resource limits (cpus, memory)'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    badRequest: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ serviceId, name, resourceLimits }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    const service = await Service.findOne({ id: serviceId }).populate(
      'environment'
    )
    if (!service) throw 'notFound'

    const environment = await Environment.findOne({
      id: service.environment.id
    }).populate('project')
    if (!environment) throw 'notFound'

    const project = await Project.findOne({ id: environment.project.id })
    if (!project || project.team !== user.team.id) throw 'notFound'

    const updates = {}

    const problems = sails.helpers.configuration.validate({
      name,
      resourceLimits
    })
    if (
      name !== undefined &&
      name.trim().length > 50 &&
      !problems.some((problem) => problem.name)
    ) {
      problems.push({ name: 'Name must be 50 characters or less.' })
    }
    if (problems.length) {
      throw { badRequest: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    // Update name if provided
    if (name !== undefined) updates.name = name.trim()

    // Update resource limits if provided
    if (resourceLimits !== undefined) {
      updates.resourceLimits = resourceLimits

      // Apply to running container via docker update (no restart needed)
      if (service.status === 'running' && service.containerName) {
        try {
          const dockerPath = sails.config.docker?.binaryPath || 'docker'
          const args = ['update']
          if (resourceLimits.cpus)
            args.push('--cpus', String(resourceLimits.cpus))
          if (resourceLimits.memory) {
            args.push('--memory', String(resourceLimits.memory))
            args.push('--memory-swap', '-1')
          }
          args.push(service.containerName)

          await execFileAsync(dockerPath, args)
          sails.log.info(
            `Applied resource limits to service ${service.containerName}: cpus=${resourceLimits.cpus}, memory=${resourceLimits.memory}`
          )
        } catch (err) {
          sails.log.warn(
            `Could not apply resource limits to ${service.containerName}: ${err.message}`
          )
          // Limits are saved to DB — they'll apply on next container recreation
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      throw {
        badRequest: {
          problems: [{ settings: 'Choose a setting to update.' }]
        }
      }
    }

    const updated = await Service.updateOne({ id: service.id }).set(updates)

    return {
      success: true,
      service: {
        id: updated.id,
        name: updated.name,
        resourceLimits: updated.resourceLimits
      }
    }
  }
}
