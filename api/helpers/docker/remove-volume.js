const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Remove volume',

  description: 'Remove a Docker volume idempotently.',

  inputs: {
    volumeName: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ volumeName }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    try {
      await execFileAsync(dockerPath, ['volume', 'rm', volumeName])
      return { removed: true, volumeName }
    } catch (error) {
      if (/no such volume/i.test(error.message || '')) {
        return { removed: false, volumeName }
      }
      throw error
    }
  }
}
