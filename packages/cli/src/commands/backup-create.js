import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, createSpinner } from '../lib/utils.js'

export default async function backupCreate(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const name = positionals[0]
  if (!name) {
    error(
      'Please provide a service name. Usage: slipway backup:create <service-name>'
    )
  }

  const project = requireProject()
  const environment = options.env || 'production'

  const spin = createSpinner('Creating backup...').start()

  try {
    // Resolve service name to ID
    const { services } = await api.services.list(project.project, environment)
    const service = services.find((s) => s.name === name)

    if (!service) {
      spin.fail('Service not found')
      error(`No service named "${name}" found in ${environment} environment.`)
    }

    const { backup } = await api.backups.create(service.id)

    spin.succeed('Backup created')

    console.log()
    console.log(`  ${c.dim('Backup ID:')}  ${backup.id}`)
    console.log(`  ${c.dim('Status:')}     ${backup.status}`)
    console.log(`  ${c.dim('Type:')}       ${backup.type}`)
    console.log()
    console.log(
      `  ${c.dim('Run')} ${c.highlight(`slipway backup:list ${name}`)} ${c.dim(
        'to check progress.'
      )}`
    )
    console.log()
  } catch (err) {
    spin.fail('Failed to create backup')
    error(err.message)
  }
}
