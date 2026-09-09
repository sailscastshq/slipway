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
    const user = await User.forRequest(this.req, { populateTeam: true })

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

    if (
      service.type === 'custom' &&
      !['owner', 'admin'].includes(user.teamRole)
    )
      throw 'notFound'
    if (service.managementMode === 'external')
      throw {
        conflict: {
          message: 'External databases have no Slipway-managed container.'
        }
      }
    if (!service.containerName) throw 'notFound'
    if (
      ['upgrading', 'restoring', 'changing', 'creating'].includes(
        service.status
      )
    ) {
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
      if (service.type === 'custom')
        await require('../../../../lib/custom-service').available(
          environment.id,
          project.id,
          service.id
        )
      const custom = require('../../../../lib/custom-service')
      if (service.type === 'custom') await custom.inspectContainer(service)
      const dockerPath = sails.config.docker?.binaryPath || 'docker'
      const stop =
        service.type === 'custom'
          ? custom.command
          : (args) => execFileAsync(dockerPath, args)
      await stop(['stop', '-t', '10', service.containerName])

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
