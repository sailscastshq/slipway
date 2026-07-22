const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Get port binding',

  description:
    'Inspect a running container and verify its published host port mapping.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    containerPort: {
      type: 'number',
      required: true
    },
    hostPort: {
      type: 'number',
      required: true
    },
    host: {
      type: 'string',
      defaultsTo: '0.0.0.0'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, containerPort, hostPort, host }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    try {
      const { stdout } = await execFileAsync(dockerPath, [
        'inspect',
        '--format',
        '{{json .NetworkSettings.Ports}}',
        containerName
      ])
      const portBindings = JSON.parse(stdout.trim() || '{}')

      return sails.helpers.docker.parsePortBindings.with({
        portBindings,
        containerPort,
        hostPort,
        host
      })
    } catch (error) {
      throw new Error(
        `Could not inspect the live Docker port mapping for ${containerName}: ${
          error.message || error
        }`
      )
    }
  }
}
