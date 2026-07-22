const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Remove image',

  description: 'Remove a deployment-scoped Docker image when it is orphaned.',

  inputs: {
    imageName: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ imageName }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    try {
      await execFileAsync(dockerPath, ['image', 'rm', imageName])
      return { removed: true }
    } catch (error) {
      if (/no such image/i.test(error.message || '')) {
        return { removed: false }
      }
      throw error
    }
  }
}
