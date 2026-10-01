const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
module.exports = {
  friendlyName: 'Clean up restore test',
  inputs: { operation: { type: 'ref', required: true } },
  fn: async function ({ operation }) {
    const name = operation.resourceName
    if (!/^slipway-restore-test-[a-f0-9-]{36}$/.test(name))
      throw new Error('Invalid test resource identity')
    const run = (args) =>
      sails.helpers.streams.runProcess.with({
        command: sails.config.docker?.binaryPath || 'docker',
        args,
        timeoutMs: 30000,
        maxStderrBytes: 16384,
        captureStdout: true
      })
    // List by exact name first: an unavailable Docker daemon is never proof of cleanup.
    const listed = await run([
      'ps',
      '-a',
      '--filter',
      `name=^/${name}$`,
      '--format',
      '{{.ID}}'
    ])
    if (!listed.stdout.trim()) {
      await fs.rm(path.join(os.tmpdir(), name), {
        recursive: true,
        force: true
      })
      return
    }
    const inspected = await run([
      'inspect',
      name,
      '--format',
      '{{json .Config.Labels}}'
    ])
    const labels = JSON.parse(inspected.stdout)
    if (
      labels?.['slipway.restore-test'] !== String(operation.id) ||
      labels?.['slipway.restore-test.resource'] !== name
    )
      throw new Error('Temporary resource ownership does not match this test')
    // All database data is tmpfs; removing this owned container removes its data too.
    await run(['rm', '-f', name])
    await fs.rm(path.join(os.tmpdir(), name), { recursive: true, force: true })
  }
}
