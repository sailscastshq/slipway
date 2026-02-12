const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Destroy service',

  description: 'Stop and remove a service container.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service record ID'
    }
  },

  exits: {
    success: {
      description: 'Service container was destroyed'
    },
    destroyFailed: {
      description: 'Failed to destroy service container'
    }
  },

  fn: async function ({ serviceId }) {
    const service = await Service.findOne({ id: serviceId })
    if (!service) {
      throw new Error('Service not found')
    }

    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const containerName = service.containerName

    try {
      // Stop the container
      try {
        await execFileAsync(dockerPath, ['stop', containerName])
        sails.log.info(`Stopped service container: ${containerName}`)
      } catch {
        // Container might already be stopped
        sails.log.verbose(`Container ${containerName} already stopped or not found`)
      }

      // Remove the container
      try {
        await execFileAsync(dockerPath, ['rm', containerName])
        sails.log.info(`Removed service container: ${containerName}`)
      } catch {
        // Container might already be removed
        sails.log.verbose(`Container ${containerName} already removed or not found`)
      }

      await Service.updateOne({ id: serviceId }).set({ status: 'stopped' })

      return { destroyed: true }
    } catch (error) {
      sails.log.error(`Failed to destroy service ${containerName}: ${error.message}`)
      throw 'destroyFailed'
    }
  }
}
