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

  const spin = createSpinner('Starting restore...').start()

  try {
    const result = await api.backups.restore(backupId)

    spin.succeed(`Restore started for backup ${result.backupId}`)
  } catch (err) {
    spin.fail('Failed to start restore')
    error(err.message)
  }
}
