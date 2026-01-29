import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, createSpinner } from '../lib/utils.js'

export default async function dbUrl(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const name = positionals[0]
  if (!name) {
    error('Please provide a database name. Usage: slipway db:url <name>')
  }

  const project = requireProject()
  const environment = options.env || 'production'

  const spin = createSpinner('Fetching database URL...').start()

  try {
    const { services } = await api.services.list(project.project, environment)

    const database = services.find(s => s.name === name)

    if (!database) {
      spin.fail('Database not found')
      error(`No database named "${name}" found in ${environment} environment.`)
    }

    spin.stop()

    console.log()
    if (database.connectionUrl) {
      console.log(database.connectionUrl)
    } else {
      console.log(`  ${c.dim('No connection URL available for this database.')}`)
    }
    console.log()
  } catch (err) {
    spin.fail('Failed to fetch database URL')
    error(err.message)
  }
}
