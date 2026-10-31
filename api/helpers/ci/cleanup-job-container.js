const { execFile } = require('node:child_process')
const execute = require('node:util').promisify(execFile)
module.exports = {
  friendlyName: 'Clean up an expired checks-only container',
  inputs: { job: { type: 'ref', required: true } },
  fn: async function ({ job }) {
    if (!job.run) return { completed: true }
    const run = await CiRun.findOne({ id: job.run, app: job.app })
    if (
      !run ||
      run.challenge?.purpose !== 'checks-only-source-v1' ||
      run.challenge.jobId !== job.jobId ||
      !/^[a-f0-9-]{36}$/.test(run.runId)
    )
      throw new Error('CI cleanup ownership could not be verified.')
    const name = `slipway-ci-server-${run.runId}`
    const docker = sails.config.docker?.binaryPath || 'docker'
    const options = { timeout: 30000, maxBuffer: 65536 }
    const { stdout: ids } = await execute(
      docker,
      ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'],
      options
    )
    if (!ids.trim()) return { completed: true }
    const { stdout } = await execute(
      docker,
      ['inspect', name, '--format', '{{json .Config.Labels}}'],
      options
    )
    if (JSON.parse(stdout)['slipway.ci.server'] !== run.runId)
      throw new Error('CI cleanup container identity changed.')
    await execute(docker, ['rm', '-f', name], options)
    return { completed: true }
  }
}
