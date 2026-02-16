const http = require('http')

module.exports = {
  friendlyName: 'Health check',

  description: 'Poll a container via HTTP until it responds, confirming it is healthy.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Container name to health-check (used as hostname on the Docker network)'
    },
    port: {
      type: 'number',
      required: true,
      description: 'Internal port the app listens on'
    },
    hostPort: {
      type: 'number',
      description: 'Host-mapped port — used as localhost fallback when Docker DNS is unavailable (e.g. local dev on macOS)'
    },
    path: {
      type: 'string',
      defaultsTo: '/',
      description: 'HTTP path to check'
    },
    timeout: {
      type: 'number',
      defaultsTo: 30000,
      description: 'Maximum time in ms to wait for a healthy response'
    },
    interval: {
      type: 'number',
      defaultsTo: 2000,
      description: 'Polling interval in ms'
    },
    deploymentId: {
      type: 'string',
      description: 'Deployment ID for logging progress'
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

  fn: async function ({ containerName, port, hostPort, path, timeout, interval, deploymentId }) {
    const startTime = Date.now()
    let lastError = null
    let attempts = 0
    let usingFallback = false

    if (deploymentId) {
      await Deployment.appendDeployLog(deploymentId, `Health check: polling http://${containerName}:${port}${path} (timeout: ${Math.round(timeout / 1000)}s)\n`)
    }

    while (Date.now() - startTime < timeout) {
      attempts++

      const checkHost = usingFallback ? 'localhost' : containerName
      const checkPort = usingFallback ? hostPort : port

      try {
        const statusCode = await httpGet(checkHost, checkPort, path)

        if (statusCode < 500) {
          sails.log.info(`Health check passed on ${checkHost}:${checkPort} (HTTP ${statusCode}, attempt ${attempts})`)
          if (deploymentId) {
            await Deployment.appendDeployLog(deploymentId, `Health check passed (HTTP ${statusCode}, attempt ${attempts})\n`)
          }
          return { statusCode, attempts }
        }

        lastError = `HTTP ${statusCode}`
      } catch (err) {
        // If Docker DNS can't resolve the container name, fall back to localhost:hostPort
        if (!usingFallback && hostPort && err.code === 'ENOTFOUND') {
          usingFallback = true
          sails.log.info(`Docker DNS unavailable, falling back to localhost:${hostPort}`)
          if (deploymentId) {
            await Deployment.appendDeployLog(deploymentId, `Docker DNS unavailable, falling back to localhost:${hostPort}\n`)
          }
          continue // Retry immediately with fallback
        }
        lastError = err.message
      }

      sails.log.verbose(`Health check attempt ${attempts} failed: ${lastError}`)

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, interval))
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const errorMsg = `Health check failed after ${elapsed}s (${attempts} attempts). Last error: ${lastError}`

    sails.log.error(errorMsg)
    if (deploymentId) {
      await Deployment.appendDeployLog(deploymentId, `${errorMsg}\n`)
    }

    throw new Error(errorMsg)
  }
}

/**
 * Make an HTTP GET request and return the status code.
 * Resolves with the status code, rejects on connection errors.
 */
function httpGet(hostname, port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname, port, path, timeout: 5000 }, (res) => {
      // Consume response data to free up memory
      res.resume()
      resolve(res.statusCode)
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
  })
}
