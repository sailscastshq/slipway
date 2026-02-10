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
    }
  },

  fn: async function ({ serviceId }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const service = await Service.findOne({ id: serviceId }).populate('environment')
    if (!service) throw 'notFound'

    const environment = await Environment.findOne({ id: service.environment.id }).populate('project')
    if (!environment) throw 'notFound'

    const project = await Project.findOne({ id: environment.project.id })
    if (!project || project.team !== user.team.id) throw 'notFound'

    if (!service.containerName) throw 'notFound'

    try {
      const dockerPath = sails.config.docker?.binaryPath || 'docker'

      // Try restart first (works for running containers)
      // If that fails, try start (works for stopped containers)
      try {
        await execFileAsync(dockerPath, ['restart', service.containerName])
      } catch {
        await execFileAsync(dockerPath, ['start', service.containerName])
      }

      await Service.updateOne({ id: service.id }).set({ status: 'running' })

      sails.log.info(`Restarted service ${service.name} (${service.containerName})`)

      return { message: 'Service restarted', status: 'running' }
    } catch (err) {
      sails.log.error(`Failed to restart service: ${err.message}`)
      throw 'notFound'
    }
  }
}
