const http = require('http')
const deploymentCancellation = require('../../lib/deployment-cancellation')
const readiness = require('../../lib/startup-readiness')

module.exports = {
  friendlyName: 'Health check',

  description:
    'Poll a container via HTTP until it responds, confirming it is healthy.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description:
        'Container name to health-check (used as hostname on the Docker network)'
    },
    port: {
      type: 'number',
      required: true,
      description: 'Internal port the app listens on'
    },
    hostPort: {
      type: 'number',
      description:
        'Host-mapped port — used as localhost fallback when Docker DNS is unavailable (e.g. local dev on macOS)'
    },
    path: {
      type: 'string',
      defaultsTo: '/health',
      description: 'HTTP path to check'
    },
    timeout: {
      type: 'number',
      defaultsTo: 120000,
      description: 'Maximum time in ms to wait for a healthy response'
    },
    interval: {
      type: 'number',
      defaultsTo: 2000,
      description: 'Polling interval in ms'
    },
    inspectContainer: {
      type: 'boolean',
      defaultsTo: false,
      description:
        'Inspect fresh candidate state while waiting for deployment startup.'
    },
    deploymentId: {
      type: 'string',
      description: 'Deployment ID for logging progress'
    },
    signal: {
      type: 'ref',
      description: 'Abort signal for an operator-requested cancellation.'
    }
  },

  exits: {
    success: {
      description: 'Container is healthy and responding to HTTP'
    },
    unhealthy: {
      description: 'Container did not respond within the timeout'
    }
  },

  fn: async function ({
    containerName,
    port,
    hostPort,
    path,
    timeout,
    interval,
    deploymentId,
    signal,
    inspectContainer
  }) {
    deploymentCancellation.throwIfCancelled(signal, deploymentId)
    const healthPath = normalizePath(path)
    const log = async (line) => {
      if (deploymentId) await Deployment.appendDeployLog(deploymentId, line)
    }
    await log(
      require('../../lib/deployment-log-events').healthPoll(
        containerName,
        port,
        healthPath,
        Math.round(timeout / 1000)
      )
    )
    try {
      const result = await readiness.poll(
        {
          containerName,
          port,
          hostPort,
          path: healthPath,
          timeout,
          interval,
          signal,
          deploymentId
        },
        {
          request: httpGet,
          delay: wait,
          log,
          sanitize: (value) => sails.hooks?.secrets?.text?.(value) ?? value,
          inspect: inspectContainer
            ? (remaining) =>
                sails.helpers.docker.getContainerStatus.with({
                  containerName,
                  fresh: true,
                  timeout: remaining,
                  signal
                })
            : null
        }
      )
      sails.log.info(
        `Health check passed: http://${result.host}:${result.port}${healthPath} returned HTTP ${result.statusCode} (attempt ${result.attempts})`
      )
      await log(
        require('../../lib/deployment-log-events').healthPassed(
          result.host,
          result.port,
          healthPath,
          result.statusCode,
          result.attempts
        )
      )
      return result
    } catch (error) {
      if (deploymentCancellation.isCancellationError(error) || signal?.aborted)
        throw error
      error.message =
        sails.hooks?.secrets?.text?.(error.message) ?? error.message
      sails.log.error(error.message)
      await log(error.message + '\n')
      throw error
    }
  }
}

/**
 * Make an HTTP GET request and return the status code.
 * Resolves with the status code, rejects on connection errors.
 */
function httpGet(hostname, port, path, signal, deploymentId, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let deadlineTimer
    const req = http.get({ hostname, port, path, timeout }, (res) => {
      // Consume response data to free up memory
      res.resume()
      settle(resolve, res.statusCode)
    })

    const abort = () => {
      req.destroy()
      settle(
        reject,
        deploymentCancellation.cancellationError(signal, deploymentId)
      )
    }

    const settle = (done, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadlineTimer)
      signal?.removeEventListener('abort', abort)
      done(value)
    }

    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()

    req.on('error', (error) => settle(reject, error))
    const timedOut = () => {
      req.destroy()
      settle(
        reject,
        Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' })
      )
    }
    deadlineTimer = setTimeout(timedOut, timeout)
    req.on('timeout', timedOut)
  })
}

function wait(duration, signal, deploymentId) {
  return new Promise((resolve, reject) => {
    let timeoutId
    const abort = () => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abort)
      reject(deploymentCancellation.cancellationError(signal, deploymentId))
    }

    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()

    timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, duration)
  })
}

function normalizePath(path) {
  const normalized = String(path || '/health').trim()
  if (!normalized) return '/health'
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}
