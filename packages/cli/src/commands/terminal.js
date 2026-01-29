import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject } from '../lib/utils.js'

export default async function terminal(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()
  const environment = options.env || 'production'

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
    console.log(`  ${c.bold(c.highlight('Terminal Access'))}`)
    console.log(`  ${c.dim(`${project.project} / ${environment}`)}`)
    console.log()
    console.log(`  ${c.dim('Container:')} ${app.containerName}`)
    console.log()
    console.log(`  ${c.dim('To open a shell, run:')}`)
    console.log(`    docker exec -it ${app.containerName} /bin/sh`)
    console.log()
    console.log(`  ${c.dim('Or for bash (if available):')}`)
    console.log(`    docker exec -it ${app.containerName} /bin/bash`)
    console.log()

    // TODO: In a production implementation, we could:
    // 1. Use a WebSocket to proxy the terminal session
    // 2. Or spawn docker exec directly with inherited stdio
  } catch (err) {
    error(err.message)
  }
}
