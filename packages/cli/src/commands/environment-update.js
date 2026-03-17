import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject } from '../lib/utils.js'

export default async function environmentUpdate(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()

  const slug = positionals[0]
  if (!slug) {
    error(
      'Please provide an environment slug. Usage: slipway environment:update <slug> [options]'
    )
  }

  const updates = {}
  if (options.name !== undefined) updates.name = options.name
  if (options.domain !== undefined) updates.domain = options.domain
  if (options.production !== undefined)
    updates.isProduction = options.production

  if (Object.keys(updates).length === 0) {
    error('No updates provided. Use --name, --domain, or --production.')
  }

  try {
    const { environment } = await api.environments.update(
      project.project,
      slug,
      updates
    )

    console.log()
    console.log(`${c.success('✓')} Environment updated`)
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
