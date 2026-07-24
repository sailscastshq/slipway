const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Discard service candidate',

  description:
    'Remove an unused upgrade candidate container and its fresh data volume.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    volumeName: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ containerName, volumeName }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    await tolerate(dockerPath, ['rm', '-f', containerName])
    await tolerate(dockerPath, ['volume', 'rm', volumeName])
  }
}

async function tolerate(dockerPath, args) {
  try {
    await execFileAsync(dockerPath, args)
  } catch {
    /* The candidate may not have reached this stage. */
  }
}
