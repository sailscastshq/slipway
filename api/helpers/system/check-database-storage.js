const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)
module.exports = {
  friendlyName: 'Check database storage',
  description:
    'Verify consistent database snapshots in a bounded child process; retain a private health report.',
  inputs: {},
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    const directory = path.join(sails.config.appPath, 'db')
    const scratch = await fs.mkdtemp(
      path.join(os.tmpdir(), 'slipway-db-check-')
    )
    let report
    try {
      const { stdout } = await exec(
        process.execPath,
        [
          path.resolve(__dirname, '../../../bin/slipway-database.cjs'),
          'check',
          '--directory',
          directory,
          '--scratch',
          scratch
        ],
        { timeout: 300000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024 }
      )
      report = JSON.parse(stdout)
    } catch (error) {
      try {
        report = JSON.parse(error.stdout)
      } catch {
        report = { ok: false, results: [], code: 'checkIncomplete' }
      }
    } finally {
      // The parent removes scratch snapshots even if the worker was killed.
      await fs.rm(scratch, { recursive: true, force: true })
    }
    report.checkedAt = new Date().toISOString()
    const target = path.join(directory, 'database-health.json')
    await fs.writeFile(
      target + '.next',
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 }
    )
    await fs.rename(target + '.next', target)
    if (!report.ok) {
      const failed =
        report.results
          .filter((item) => !item.ok)
          .map((item) => item.database)
          .join(', ') || 'incomplete check'
      const message = `System database verification needs attention (${failed}). Preserve database files and journals; check disk space and follow docs/sqlite-recovery.md before updating.`
      sails.log.error(message)
      await sails.helpers.notification.sendJobFailureNotification
        .with({
          jobName: 'check-system-databases',
          errorMessage: message
        })
        .tolerate('error')
    }
    return report
  }
}
