const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

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
    // Check cache first
    const cacheKey = `container:status:${containerName}`
    try {
      const cached = await sails.cache.get(cacheKey)
      if (cached) {
        return cached
      }
    } catch (err) {
      sails.log.verbose('Cache read failed for container status:', err.message)
    }

    try {
      const { stdout } = await execFileAsync('docker', [
        'inspect',
        '--format',
        '{{json .State}}',
        containerName
      ])

      const state = JSON.parse(stdout.trim())

      const result = {
        running: state.Running,
        status: state.Status,
        startedAt: state.StartedAt,
        finishedAt: state.FinishedAt,
        exitCode: state.ExitCode,
        error: state.Error,
        health: state.Health ? state.Health.Status : null
      }

      // Cache for 30 seconds
      try {
        await sails.cache.set(cacheKey, result, 30_000)
      } catch (err) {
        /* best-effort */
      }

      return result
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
