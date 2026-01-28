const { exec } = require('child_process')
const util = require('util')
const execAsync = util.promisify(exec)

module.exports = {
  friendlyName: 'Get container logs',
  description: 'Get logs from a running Docker container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Name or ID of the container'
    },
    tail: {
      type: 'number',
      defaultsTo: 100,
      description: 'Number of lines to return from the end'
    },
    since: {
      type: 'string',
      description:
        'Show logs since timestamp (e.g., 2021-01-01T00:00:00Z) or relative (e.g., 10m)'
    },
    timestamps: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Show timestamps'
    }
  },

  exits: {
    success: {
      description: 'Logs retrieved successfully',
      outputType: 'string'
    },
    notFound: {
      description: 'Container not found'
    }
  },

  fn: async function ({ containerName, tail, since, timestamps }) {
    let cmd = `docker logs --tail ${tail}`

    if (timestamps) {
      cmd += ' --timestamps'
    }

    if (since) {
      cmd += ` --since ${since}`
    }

    cmd += ` ${containerName}`

    try {
      const { stdout, stderr } = await execAsync(cmd)
      // Docker logs can output to both stdout and stderr
      return stdout + stderr
    } catch (error) {
      if (error.message.includes('No such container')) {
        throw 'notFound'
      }
      throw error
    }
  }
}
