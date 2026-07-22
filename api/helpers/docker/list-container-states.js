const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'List container states',

  description:
    'List authoritative lifecycle states for all Docker containers, including stopped containers.',

  inputs: {},

  exits: {
    success: {
      description: 'Container lifecycle states retrieved.',
      outputType: 'ref'
    }
  },

  fn: async function () {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const { stdout } = await execFileAsync(
      dockerPath,
      ['container', 'ls', '--all', '--format', '{{json .}}'],
      { maxBuffer: 10 * 1024 * 1024 }
    )

    return parseContainerStates(stdout)
  }
}

function parseContainerStates(stdout) {
  if (!stdout || !stdout.trim()) return []

  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      let raw
      try {
        raw = JSON.parse(line)
      } catch (error) {
        throw new Error(`Could not parse Docker container state: ${line}`, {
          cause: error
        })
      }

      const name = raw.Names || raw.Name
      const state = String(raw.State || '').toLowerCase()
      if (!name || !state) {
        throw new Error(
          `Docker container state is missing a name or state: ${line}`
        )
      }

      return {
        id: raw.ID || null,
        name,
        state,
        running: state === 'running',
        status: raw.Status || null
      }
    })
}

module.exports._private = { parseContainerStates }
