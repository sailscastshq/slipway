import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, createSpinner } from '../lib/utils.js'

export default async function backupRestore(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const backupId = positionals[0]
  if (!backupId) {
    error(
      'Please provide a backup ID. Usage: slipway backup:restore <backup-id>'
    )
  }

  if (!options.writesPaused && !options['writes-paused'])
    error(
      'Pause application and external database writes, then run backup:restore with --writes-paused.'
    )

  const spin = createSpinner('Starting restore...').start()

  try {
    let result = await api.backups.restore(backupId)
    if (!result.operation)
      throw new Error(
        'Server did not return a restore operation; inspect server logs before retrying.'
      )
    const id = result.operation.id
    const deadline = Date.now() + 60 * 60 * 1000
    while (['queued', 'running'].includes(result.operation.status)) {
      spin.text = `Restore ${id}: ${result.operation.stage}${
        result.operation.snapshotId
          ? ` (safety snapshot ${result.operation.snapshotId})`
          : ''
      }`
      if (Date.now() > deadline)
        throw new Error(
          `Restore ${id} is still pending. Check /api/v1/restore-operations/${id}; keep writes paused.`
        )
      await new Promise((resolve) => setTimeout(resolve, 1000))
      result = await api.get(`/restore-operations/${id}`)
    }
    if (result.operation.status !== 'completed')
      throw new Error(
        `Restore ${id}: ${result.operation.error}. Safety snapshot: ${
          result.operation.snapshotId || 'unavailable'
        }`
      )
    spin.succeed(
      `Restore ${id} completed. Verify the database before resuming writes.`
    )
  } catch (err) {
    spin.fail('Failed to start restore')
    error(err.message)
  }
}
