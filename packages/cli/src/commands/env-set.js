import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, success, createSpinner } from '../lib/utils.js'

export default async function envSet(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  if (positionals.length === 0) {
    error(
      'Please provide at least one KEY=value pair. Usage: slipway env:set KEY=value'
    )
  }

  const project = requireProject()
  const environment = options.env || 'production'

  // Parse KEY=value pairs
  const vars = {}
  for (const pair of positionals) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex === -1) {
      error(`Invalid format: "${pair}". Use KEY=value format.`)
    }
    const key = pair.substring(0, eqIndex)
    const value = pair.substring(eqIndex + 1)

    if (!key) {
      error(`Invalid key in "${pair}". Key cannot be empty.`)
    }

    vars[key] = value
  }

  const spin = createSpinner('Setting environment variables...').start()

  try {
    // Get current environment
    const { environment: env } = await api.environments.get(
      project.project,
      environment
    )

    // Merge with existing vars
    const updatedVars = { ...env.envVars, ...vars }

    // Update environment
    await api.environments.update(project.project, environment, {
      envVars: updatedVars
    })

    spin.succeed('Environment variables updated')
    console.log()

    for (const key of Object.keys(vars)) {
      console.log(`  ${c.success('+')} ${key}`)
    }

    console.log()
    console.log(
      `  ${c.dim('Run')} ${c.highlight('slipway slide')} ${c.dim(
        'to apply changes.'
      )}`
    )
    console.log()
  } catch (err) {
    spin.fail('Failed to set environment variables')
    error(err.message)
  }
}
