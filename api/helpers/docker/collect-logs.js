const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)
const countLogLines = require('../../lib/count-log-lines')

module.exports = {
  friendlyName: 'Collect logs',

  description: 'Collect Docker container logs since a given timestamp.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name'
    },
    since: {
      type: 'string',
      required: true,
      description: 'Timestamp to collect logs from (ISO 8601 or relative)'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, since }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    try {
      const { stdout, stderr } = await execFileAsync(
        dockerPath,
        ['logs', '--since', since, '--timestamps', containerName],
        {
          maxBuffer: 1024 * 1024 * 10, // 10MB max
          timeout: 30000
        }
      )

      // Docker logs outputs to both stdout and stderr
      const combined = (stdout || '') + (stderr || '')

      return {
        logs: combined,
        lineCount: countLogLines(combined)
      }
    } catch (err) {
      sails.log.verbose(
        `Failed to collect logs for ${containerName}: ${err.message}`
      )
      return { logs: '', lineCount: 0 }
    }
  }
}
