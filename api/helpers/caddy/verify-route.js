const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Verify route',

  description:
    'Wait for the expected generated route, then require Caddy to accept it as active configuration.',

  inputs: {
    expectedUpstreams: {
      type: 'ref',
      required: true,
      description:
        'Container upstreams that must appear as host:port values. May be empty when verifying removal.'
    },
    excludedUpstreams: {
      type: 'ref',
      defaultsTo: [],
      description: 'Container upstreams that must no longer appear.'
    },
    timeoutMs: {
      type: 'number',
      defaultsTo: 10000,
      description: 'Maximum time to wait for caddy-docker-proxy to reload.'
    }
  },

  exits: {
    success: {
      description: 'The expected route is present in Caddy.',
      outputType: 'ref'
    }
  },

  fn: async function ({ expectedUpstreams, excludedUpstreams, timeoutMs }) {
    excludedUpstreams = Array.isArray(excludedUpstreams)
      ? excludedUpstreams
      : []
    if (
      !Array.isArray(expectedUpstreams) ||
      (expectedUpstreams.length === 0 && excludedUpstreams.length === 0)
    ) {
      throw createVerificationError('No Caddy route assertions were provided.')
    }

    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const proxyContainer =
      sails.config.custom.slipwayProxyContainer || 'slipway-proxy'
    const deadline = Date.now() + timeoutMs
    let lastError

    while (Date.now() <= deadline) {
      try {
        const configPath = '/config/caddy/Caddyfile.autosave'
        const { stdout } = await execFileAsync(
          dockerPath,
          caddyCommand(proxyContainer, 'adapt', configPath)
        )

        const missingUpstreams = expectedUpstreams.filter(
          (upstream) => !stdout.includes(upstream)
        )
        const staleUpstreams = excludedUpstreams.filter((upstream) =>
          stdout.includes(upstream)
        )

        if (missingUpstreams.length > 0 || staleUpstreams.length > 0) {
          lastError = new Error(
            [
              missingUpstreams.length > 0
                ? `missing ${missingUpstreams.join(', ')}`
                : null,
              staleUpstreams.length > 0
                ? `still includes ${staleUpstreams.join(', ')}`
                : null
            ]
              .filter(Boolean)
              .join('; ')
          )
        } else {
          // `adapt` proves caddy-docker-proxy rendered the intended route.
          // `reload` talks to Caddy's admin API and blocks until that exact
          // Caddyfile is accepted; Caddy keeps the previous active config if
          // the reload fails.
          await execFileAsync(
            dockerPath,
            caddyCommand(proxyContainer, 'reload', configPath)
          )
          return { expectedUpstreams }
        }
      } catch (error) {
        lastError = error
      }

      await wait(100)
    }

    throw createVerificationError(
      `Caddy did not load the expected route within ${timeoutMs}ms: ${
        lastError?.message || 'unknown verification failure'
      }`,
      lastError
    )
  }
}

function createVerificationError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = 'CADDY_ROUTE_VERIFICATION_FAILED'
  return error
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function caddyCommand(proxyContainer, command, configPath) {
  return [
    'exec',
    proxyContainer,
    'caddy',
    command,
    '--config',
    configPath,
    '--adapter',
    'caddyfile'
  ]
}

module.exports._private = { caddyCommand, createVerificationError }
