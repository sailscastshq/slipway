const commandRuntime = require('../../lib/helm-command-runtime')

module.exports = {
  friendlyName: 'Execute command in container',
  description:
    'Run one bounded, non-interactive command in a verified app runtime.',
  inputs: {
    containerName: { type: 'string', required: true },
    argv: { type: 'ref', required: true },
    executionId: { type: 'string', required: true },
    expectedRuntime: { type: 'ref', required: true },
    signal: { type: 'ref' },
    onEvent: { type: 'ref' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function (inputs) {
    const limits = sails.config.custom.helm
    return commandRuntime.executeCommand({
      ...inputs,
      dockerPath: sails.config.docker?.binaryPath || 'docker',
      timeoutMs: limits.timeoutMs,
      killGraceMs: limits.killGraceMs,
      processGraceMs: limits.processGraceMs,
      maxOutputBytes: limits.maxLogBytes
    })
  }
}
