const STOP_SCRIPT = `
const fs = require('node:fs')
const executionId = process.argv[1]
const pidFile = '/tmp/slipway-helm-' + executionId + '.pid'

try {
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  const environment = fs.readFileSync('/proc/' + pid + '/environ')
  const marker = Buffer.from('SLIPWAY_HELM_EXECUTION_ID=' + executionId + '\\0')

  if (Number.isSafeInteger(pid) && pid > 1 && environment.includes(marker)) {
    process.kill(pid, 'SIGKILL')
  }
} catch (error) {
  if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
} finally {
  try {
    fs.unlinkSync(pidFile)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
`

module.exports = {
  friendlyName: 'Stop container Helm execution',

  description:
    'Terminate the exact Helm Node process still running inside an app container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    executionId: {
      type: 'string',
      required: true,
      regex:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    }
  },

  exits: {
    success: {
      outputType: 'boolean'
    }
  },

  fn: async function ({ containerName, executionId }) {
    const limits = sails.config.custom.helm
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    try {
      await sails.helpers.streams.runProcess.with({
        command: dockerPath,
        args: ['exec', containerName, 'node', '-e', STOP_SCRIPT, executionId],
        timeoutMs: Math.max(1000, limits.killGraceMs * 4),
        maxOutputBytes: 1024,
        maxStderrBytes: 4096,
        killGraceMs: limits.killGraceMs
      })
      return true
    } catch (error) {
      sails.log.warn(
        `Could not stop Helm execution ${executionId} in ${containerName}: ${error.message}`
      )
      return false
    }
  }
}
