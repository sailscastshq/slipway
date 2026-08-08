const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Health check container',

  description:
    'Poll an HTTP endpoint from inside a container without relying on Docker DNS or host port reachability.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    port: {
      type: 'number',
      defaultsTo: 1337
    },
    path: {
      type: 'string',
      defaultsTo: '/health'
    },
    timeout: {
      type: 'number',
      defaultsTo: 60000
    },
    interval: {
      type: 'number',
      defaultsTo: 2000
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, port, path, timeout, interval }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    return await waitForContainerHttp({
      execute: execFileAsync,
      dockerPath,
      containerName,
      port,
      path,
      timeout,
      interval,
      clock: {
        now: () => Date.now(),
        wait: delay
      }
    })
  }
}

async function waitForContainerHttp({
  execute,
  dockerPath,
  containerName,
  port,
  path,
  timeout,
  interval,
  clock
}) {
  const healthPath = normalizePath(path)
  const endpoint = `http://localhost:${port}${healthPath}`
  const startedAt = clock.now()
  let attempts = 0
  let lastError = 'The candidate did not answer.'

  do {
    attempts += 1
    const remaining = Math.max(1, timeout - (clock.now() - startedAt))
    const probeTimeout = Math.min(5000, remaining)

    try {
      await execute(
        dockerPath,
        buildProbeArgs({
          containerName,
          endpoint,
          probeTimeout
        }),
        {
          timeout: probeTimeout + 2000,
          maxBuffer: 64 * 1024
        }
      )

      sails.log.info(
        `Container health check passed inside ${containerName} (attempt ${attempts})`
      )
      return { attempts, endpoint }
    } catch (error) {
      lastError = String(error.stderr || error.message || error).trim()
    }

    const elapsed = clock.now() - startedAt
    if (elapsed >= timeout) break
    await clock.wait(Math.min(interval, timeout - elapsed))
  } while (clock.now() - startedAt < timeout)

  const error = new Error(
    `Container health check failed inside ${containerName} after ${attempts} attempts. Last error: ${lastError}`
  )
  error.code = 'CONTAINER_HEALTH_CHECK_FAILED'
  throw error
}

function buildProbeArgs({ containerName, endpoint, probeTimeout }) {
  return [
    'exec',
    containerName,
    'curl',
    '-fsS',
    '--max-time',
    String(Math.max(1, Math.ceil(probeTimeout / 1000))),
    endpoint
  ]
}

function normalizePath(path) {
  const normalized = String(path || '/health').trim()
  if (!normalized) return '/health'
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

module.exports._private = {
  buildProbeArgs,
  normalizePath,
  waitForContainerHttp
}
