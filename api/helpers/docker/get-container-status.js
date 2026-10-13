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
    },
    timeout: { type: 'number', defaultsTo: 5000, min: 1, max: 5000 },
    signal: { type: 'ref' },
    fresh: {
      type: 'boolean',
      defaultsTo: false,
      description:
        'Bypass the short-lived status cache for lifecycle decisions.'
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
  fn: async function ({ containerName, fresh, timeout = 5000, signal }) {
    // Check cache first
    const cacheKey = `container:status:v2:${containerName}`
    if (!fresh) {
      try {
        const cached = await sails.cache.get(cacheKey)
        if (cached) {
          return cached
        }
      } catch (err) {
        sails.log.verbose(
          'Cache read failed for container status:',
          err.message
        )
      }
    }

    try {
      const { stdout } = await execFileAsync(
        sails.config.docker?.binaryPath || 'docker',
        ['inspect', '--format', '{{json .State}}', containerName],
        { timeout, signal, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 }
      )

      const state = JSON.parse(stdout.trim())

      const result = {
        running: state.Running,
        restarting: Boolean(state.Restarting),
        oomKilled: Boolean(state.OOMKilled),
        status: state.Status,
        startedAt: state.StartedAt,
        finishedAt: state.FinishedAt,
        exitCode: state.ExitCode,
        error: state.Error,
        health: state.Health ? state.Health.Status : null
      }

      // Cache for 30 seconds
      try {
        if (!fresh) await sails.cache.set(cacheKey, result, 30)
      } catch (err) {
        /* best-effort */
      }

      return result
    } catch (error) {
      if (isMissingContainerError(error)) {
        throw 'notFound'
      }
      throw error
    }
  }
}

function isMissingContainerError(error) {
  const output = [error?.message, error?.stderr]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()

  return (
    output.includes('no such container') || output.includes('no such object')
  )
}

module.exports._private = { isMissingContainerError }
