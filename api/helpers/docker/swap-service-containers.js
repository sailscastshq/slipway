const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Swap service containers',

  description:
    'Atomically promote an upgraded service container or restore the retained previous container.',

  inputs: {
    action: {
      type: 'string',
      isIn: ['commit', 'rollback'],
      required: true
    },
    canonicalName: {
      type: 'string',
      required: true
    },
    candidateName: {
      type: 'string',
      required: true
    },
    rollbackName: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ action, canonicalName, candidateName, rollbackName }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    if (action === 'rollback') {
      await tolerate(dockerPath, ['stop', canonicalName])
      await tolerate(dockerPath, ['rename', canonicalName, candidateName])
      await execFileAsync(dockerPath, ['rename', rollbackName, canonicalName])
      await execFileAsync(dockerPath, ['start', canonicalName])
      return { rolledBack: true }
    }

    let previousRenamed = false
    let candidatePromoted = false
    try {
      await execFileAsync(dockerPath, ['stop', canonicalName])
      await execFileAsync(dockerPath, ['rename', canonicalName, rollbackName])
      previousRenamed = true
      await execFileAsync(dockerPath, ['rename', candidateName, canonicalName])
      candidatePromoted = true
      return { committed: true }
    } catch (error) {
      if (candidatePromoted) {
        await tolerate(dockerPath, ['rename', canonicalName, candidateName])
      }
      if (previousRenamed) {
        await tolerate(dockerPath, ['rename', rollbackName, canonicalName])
      }
      await tolerate(dockerPath, ['start', canonicalName])
      throw error
    }
  }
}

async function tolerate(dockerPath, args) {
  try {
    await execFileAsync(dockerPath, args)
  } catch {
    /* Best-effort rollback cleanup. */
  }
}
