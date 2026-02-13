const http = require('http')

module.exports = {
  friendlyName: 'Health check',

  description: 'Poll a container via HTTP until it responds, confirming it is healthy.',

  inputs: {
    hostPort: {
      type: 'number',
      required: true,
      description: 'Host port the container is mapped to'
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

  fn: async function ({ hostPort, path, timeout, interval, deploymentId }) {
    const startTime = Date.now()
    let lastError = null
    let attempts = 0

    if (deploymentId) {
      await Deployment.appendDeployLog(deploymentId, `Health check: polling http://localhost:${hostPort}${path} (timeout: ${Math.round(timeout / 1000)}s)\n`)
    }

    while (Date.now() - startTime < timeout) {
      attempts++

      try {
        const statusCode = await httpGet(hostPort, path)

        if (statusCode < 500) {
          sails.log.info(`Health check passed on port ${hostPort} (HTTP ${statusCode}, attempt ${attempts})`)
          if (deploymentId) {
            await Deployment.appendDeployLog(deploymentId, `Health check passed (HTTP ${statusCode}, attempt ${attempts})\n`)
          }
          return { statusCode, attempts }
        }

        lastError = `HTTP ${statusCode}`
      } catch (err) {
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

    throw { exit: 'unhealthy', message: errorMsg }
  }
}

/**
 * Make an HTTP GET request and return the status code.
 * Resolves with the status code, rejects on connection errors.
 */
function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, timeout: 5000 }, (res) => {
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
