import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject } from '../lib/utils.js'

export default async function environmentCreate(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()

  const name = positionals[0]
  if (!name) {
    error(
      'Please provide an environment name. Usage: slipway environment:create <name>'
    )
  }

  try {
    const data = { name }
    if (options.production) data.isProduction = true
    if (options.domain) data.domain = options.domain

    const { environment } = await api.environments.create(project.project, data)

    console.log()
    console.log(`${c.success('✓')} Environment created`)
    console.log()
    console.log(`  ${c.dim('Name:')} ${environment.name}`)
    console.log(`  ${c.dim('Slug:')} ${environment.slug}`)
    console.log(
      `  ${c.dim('Type:')} ${
        environment.isProduction ? 'production' : 'staging'
      }`
    )
    if (environment.domain) {
      console.log(`  ${c.dim('Domain:')} ${environment.domain}`)
    }
    console.log()
  } catch (err) {
    error(err.message)
  }
}
