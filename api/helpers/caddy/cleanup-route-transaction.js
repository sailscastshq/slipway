const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Cleanup route transaction',

  description:
    'Remove deployment-scoped Caddy route containers left by an interrupted cutover.',

  inputs: {
    environmentId: {
      type: 'string',
      required: true
    },
    routeVersion: {
      type: 'string',
      required: true
    },
    phase: {
      type: 'string',
      isIn: ['before-repair', 'after-repair'],
      required: true
    }
  },

  fn: async function ({ environmentId, routeVersion, phase }) {
    const environment = await Environment.findOne({
      id: environmentId
    }).populate('project')
    if (!environment?.project) return { removed: [] }

    const routeId = `slipway-route-${environment.project.slug}-${environment.slug}`
    const suffix = normalizeContainerSuffix(routeVersion)
    const candidates = [`${routeId}-candidate-${suffix}`]
    if (phase === 'after-repair') {
      candidates.push(`${routeId}-previous-${suffix}`)
    }

    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const removed = []
    for (const containerName of candidates) {
      try {
        await execFileAsync(dockerPath, ['rm', '-f', containerName])
        removed.push(containerName)
      } catch {
        // Cleanup is idempotent; the named transaction container may not exist.
      }
    }

    return { removed }
  }
}

function normalizeContainerSuffix(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

module.exports._private = { normalizeContainerSuffix }
