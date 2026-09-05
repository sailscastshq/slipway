const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Stop service',

  description: 'Stop a running service container.',

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
    const user = await User.findOne({
      id: this.req.auth?.userId || this.req.session.userId
    }).populate('team')

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
    if (['upgrading', 'restoring', 'changing'].includes(service.status)) {
      throw {
        conflict: { message: 'The service has an active upgrade or restore.' }
      }
    }

    const claimed = await Service.updateOne({
      id: service.id,
      status: service.status
    }).set({ status: 'changing' })
    if (!claimed)
      throw {
        conflict: {
          message: 'Another service operation started. Refresh and retry.'
        }
      }
    try {
      const dockerPath = sails.config.docker?.binaryPath || 'docker'
      await execFileAsync(dockerPath, [
        'stop',
        '-t',
        '10',
        service.containerName
      ])

      await Service.updateOne({ id: service.id }).set({ status: 'stopped' })

      sails.log.info(
        `Stopped service ${service.name} (${service.containerName})`
      )

      return { message: 'Service stopped', status: 'stopped' }
    } catch (err) {
      sails.log.error(`Failed to stop service: ${err.message}`)
      throw 'notFound'
    } finally {
      await Service.updateOne({ id: service.id, status: 'changing' }).set({
        status: service.status
      })
    }
  }
}
