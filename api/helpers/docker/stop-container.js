const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Stop container',

  description: 'Stop and optionally remove a Docker container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Name or ID of the container to stop'
    },
    remove: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Whether to remove the container after stopping'
    },
    timeout: {
      type: 'number',
      defaultsTo: 10,
      description: 'Seconds to wait before forcing stop'
    }
  },

  exits: {
    success: {
      description: 'Container was stopped'
    },
    notFound: {
      description: 'Container not found'
    }
  },

  fn: async function ({ containerName, remove, timeout }) {
    try {
      // Check if container exists
      await execFileAsync('docker', ['inspect', containerName])
    } catch {
      sails.log.verbose(`Container ${containerName} not found`)
      throw 'notFound'
    }

    try {
      // Stop the container
      await execFileAsync('docker', [
        'stop',
        '-t',
        String(timeout),
        containerName
      ])
      sails.log.info(`Stopped container: ${containerName}`)

      if (remove) {
        await execFileAsync('docker', ['rm', containerName])
        sails.log.info(`Removed container: ${containerName}`)
      }

      return { stopped: true, removed: remove }
    } catch (error) {
      sails.log.error(
        `Failed to stop container ${containerName}: ${error.message}`
      )
      throw error
    }
  }
}
