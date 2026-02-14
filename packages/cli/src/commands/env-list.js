import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject } from '../lib/utils.js'

export default async function envList(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()
  const environment = options.env || 'production'

  console.log()
  console.log(`  ${c.bold(c.highlight('Environment Variables'))}`)
  console.log(`  ${c.dim(`${project.project} / ${environment}`)}`)
  console.log()

  try {
    const { environment: env } = await api.environments.get(project.project, environment)

    const vars = env.envVars || {}
    const keys = Object.keys(vars).sort()

    if (keys.length === 0) {
      console.log(`  ${c.dim('No environment variables set.')}`)
      console.log(`  ${c.dim('Use')} ${c.highlight('slipway env:set KEY=value')} ${c.dim('to add variables.')}`)
      console.log()
      return
    }

    for (const key of keys) {
      const value = vars[key]
      // Mask sensitive values
      const masked = shouldMask(key) ? '••••••••' : value
      console.log(`  ${c.dim(key + '=')}${masked}`)
    }

    console.log()
  } catch (err) {
    error(err.message)
  }
}

// Keys that should have their values masked
function shouldMask(key) {
  const sensitivePatterns = [
    'PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'PRIVATE',
    'CREDENTIAL', 'AUTH', 'API_KEY', 'APIKEY'
  ]
  const upper = key.toUpperCase()
  return sensitivePatterns.some(p => upper.includes(p))
}
