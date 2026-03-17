const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Ensure network',

  description:
    'Ensure the Slipway Docker network exists, creating it if necessary.',

  inputs: {
    networkName: {
      type: 'string',
      defaultsTo: 'slipway',
      description: 'Name of the Docker network'
    }
  },

  exits: {
    success: {
      description: 'Network exists or was created'
    },
    dockerError: {
      description: 'Docker command failed'
    }
  },

  fn: async function ({ networkName }) {
    const network =
      networkName || sails.config.custom.slipwayNetwork || 'slipway'

    try {
      // Check if network exists
      await execFileAsync('docker', ['network', 'inspect', network])
      sails.log.verbose(`Docker network '${network}' already exists`)
      return { exists: true, created: false, network }
    } catch {
      // Network doesn't exist, create it
      try {
        await execFileAsync('docker', ['network', 'create', network])
        sails.log.info(`Created Docker network '${network}'`)
        return { exists: true, created: true, network }
      } catch (createError) {
        sails.log.error(
          `Failed to create Docker network: ${createError.message}`
        )
        throw 'dockerError'
      }
    }
  }
}
