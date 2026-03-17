import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import {
  error,
  requireProject,
  createSpinner,
  table,
  formatDate,
  formatBytes,
  formatDuration,
  statusColor
} from '../lib/utils.js'

export default async function backupList(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const name = positionals[0]
  if (!name) {
    error(
      'Please provide a service name. Usage: slipway backup:list <service-name>'
    )
  }

  const project = requireProject()
  const environment = options.env || 'production'

  const spin = createSpinner('Fetching backups...').start()

  try {
    // Resolve service name to ID
    const { services } = await api.services.list(project.project, environment)
    const service = services.find((s) => s.name === name)

    if (!service) {
      spin.fail('Service not found')
      error(`No service named "${name}" found in ${environment} environment.`)
    }

    const { backups } = await api.backups.list(service.id)

    spin.stop()

    console.log()
    console.log(
      `  ${c.bold(c.highlight('Backups'))} ${c.dim(
        `— ${name} (${environment})`
      )}`
    )
    console.log()

    if (!backups || backups.length === 0) {
      console.log(`  ${c.dim('No backups found.')}`)
      console.log(
        `  ${c.dim('Run')} ${c.highlight(
          `slipway backup:create ${name}`
        )} ${c.dim('to create one.')}`
      )
      console.log()
      return
    }

    const rows = backups.map((b) => [
      b.id,
      statusColor(b.status),
      b.type,
      formatBytes(b.sizeBytes),
      b.durationMs ? formatDuration(Math.round(b.durationMs / 1000)) : 'N/A',
      formatDate(b.createdAt)
    ])

    table(['ID', 'Status', 'Type', 'Size', 'Duration', 'Date'], rows)

    console.log()
  } catch (err) {
    spin.fail('Failed to fetch backups')
    error(err.message)
  }
}
