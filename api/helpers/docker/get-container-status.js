const { exec } = require('child_process')
const util = require('util')
const execAsync = util.promisify(exec)

module.exports = {
  friendlyName: 'Get container status',
  description: 'Get the status of a Docker container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Name or ID of the container'
    }
  },
  exits: {
    success: {
      description: 'Container status retrieved',
      outputType: 'ref'
    },
    notFound: {
      description: 'Container not found'
    }
  },
  fn: async function ({ containerName }) {
    try {
      const { stdout } = await execAsync(
        `docker inspect --format '{{json .State}}' ${containerName}`
      )

      const state = JSON.parse(stdout.trim())

      return {
        running: state.Running,
        status: state.Status,
        startedAt: state.StartedAt,
        finishedAt: state.FinishedAt,
        exitCode: state.ExitCode,
        error: state.Error,
        health: state.Health ? state.Health.Status : null
      }
    } catch (error) {
      if (
        error.message.includes('No such container') ||
        error.message.includes('No such object')
      ) {
        throw 'notFound'
      }
      throw error
    }
  }
}
