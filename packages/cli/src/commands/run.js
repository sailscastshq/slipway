import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject } from '../lib/utils.js'

export default async function runCommand(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  if (positionals.length === 0) {
    error('Please provide a command to run. Usage: slipway exec <command>')
  }

  const project = requireProject()
  const environment = options.env || 'production'
  const cmd = positionals.join(' ')

  try {
    // Get environment to find container name
    const { environment: env } = await api.environments.get(project.project, environment)

    if (!env.app || env.app.length === 0) {
      error('No app deployed in this environment. Run `slipway deploy` first.')
    }

    const app = env.app[0]
    if (app.status !== 'running') {
      error(`App is not running (status: ${app.status})`)
    }

    console.log()
    console.log(`  ${c.dim('Container:')} ${app.containerName}`)
    console.log(`  ${c.dim('Command:')} ${cmd}`)
    console.log()
    console.log(`  ${c.dim('To run this command, use:')}`)
    console.log(`    docker container run ${app.containerName} ${cmd}`)
    console.log()

    // TODO: In a production implementation, we would:
    // 1. Run via API endpoint that uses docker on the server
    // 2. Stream the output back to the CLI
  } catch (err) {
    error(err.message)
  }
}
