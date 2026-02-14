import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, createSpinner } from '../lib/utils.js'

export default async function envUnset(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  if (positionals.length === 0) {
    error('Please provide at least one key to remove. Usage: slipway env:unset KEY1 KEY2')
  }

  const project = requireProject()
  const environment = options.env || 'production'

  const spin = createSpinner('Removing environment variables...').start()

  try {
    // Get current environment
    const { environment: env } = await api.environments.get(project.project, environment)

    // Remove specified keys
    const updatedVars = { ...env.envVars }
    const removed = []

    for (const key of positionals) {
      if (key in updatedVars) {
        delete updatedVars[key]
        removed.push(key)
      }
    }

    if (removed.length === 0) {
      spin.stop()
      console.log()
      console.log(`  ${c.dim('No matching variables found to remove.')}`)
      console.log()
      return
    }

    // Update environment
    await api.environments.update(project.project, environment, {
      envVars: updatedVars
    })

    spin.succeed('Environment variables removed')
    console.log()

    for (const key of removed) {
      console.log(`  ${c.error('-')} ${key}`)
    }

    console.log()
    console.log(`  ${c.dim('Run')} ${c.highlight('slipway slide')} ${c.dim('to apply changes.')}`)
    console.log()
  } catch (err) {
    spin.fail('Failed to remove environment variables')
    error(err.message)
  }
}
