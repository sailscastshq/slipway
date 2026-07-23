const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Restart service',

  description: 'Restart a service container.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service ID'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    conflict: {
      statusCode: 409
    }
  },

  fn: async function ({ serviceId }) {
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

    if (!service.containerName) throw 'notFound'
    if (service.status === 'upgrading') {
      throw { conflict: { message: 'The service is currently upgrading.' } }
    }

    try {
      const dockerPath = sails.config.docker?.binaryPath || 'docker'

      // Use different commands based on container state
      // For stopped containers, use 'start'. For running ones, use 'restart'.
      if (service.status === 'stopped' || service.status === 'failed') {
        await execFileAsync(dockerPath, ['start', service.containerName])
        sails.log.info(
          `Started service ${service.name} (${service.containerName})`
        )
      } else {
        await execFileAsync(dockerPath, ['restart', service.containerName])
        sails.log.info(
          `Restarted service ${service.name} (${service.containerName})`
        )
      }

      await Service.updateOne({ id: service.id }).set({ status: 'running' })

      return { message: 'Service started', status: 'running' }
    } catch (err) {
      sails.log.error(`Failed to start/restart service: ${err.message}`)
      throw 'notFound'
    }
  }
}
