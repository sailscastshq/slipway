const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)
const { createRedactor } = require('../security/redact')._private
module.exports = {
  friendlyName: 'Capture startup diagnostics',
  inputs: {
    containerName: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true },
    envVars: { type: 'ref', defaultsTo: {} }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ containerName, deploymentId, envVars }) {
    const redact = sails.hooks?.secrets || createRedactor()
    redact.remember({ env: envVars })
    const text = (value) => {
      const stream = redact.stream()
      return stream.write(Buffer.from(String(value || ''))) + stream.end()
    }
    const binary = sails.config.docker?.binaryPath || 'docker'
    const [stateResult, logResult] = await Promise.allSettled([
      sails.helpers.docker.getContainerStatus.with({
        containerName,
        fresh: true,
        timeout: 5000
      }),
      exec(binary, ['logs', '--tail', '100', '--timestamps', containerName], {
        timeout: 5000,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024
      })
    ])
    const state = stateResult.status === 'fulfilled' ? stateResult.value : null
    let output = '\n--- Startup diagnostics ---\n'
    output += state
      ? `Container state: ${state.status}; exit code: ${
          state.exitCode ?? 'unknown'
        }; OOM killed: ${state.oomKilled ? 'yes' : 'no'}\n`
      : 'Container state unavailable. It may have exited or been removed.\n'
    if (state?.error) output += 'Container error: ' + text(state.error) + '\n'
    const process =
      logResult.status === 'fulfilled' ? logResult.value : logResult.reason
    for (const channel of ['stdout', 'stderr']) {
      if (process?.[channel])
        output += `--- Startup ${channel} ---\n` + text(process[channel]) + '\n'
    }
    if (logResult.status === 'rejected')
      output += 'Startup output capture was incomplete or exceeded its bound.\n'
    if (!process?.stdout && !process?.stderr)
      output += 'No startup output was available.\n'
    output = redact.text(output)
    await Deployment.appendDeployLog(deploymentId, output)
    return {
      captured: true,
      state: state ? redact.protect(state) : null,
      output
    }
  }
}
