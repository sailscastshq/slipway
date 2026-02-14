import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, createSpinner } from '../lib/utils.js'

export default async function logs(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  // If deployment ID is provided, show deployment logs
  if (options.deployment) {
    return showDeploymentLogs(options.deployment)
  }

  const project = requireProject()
  const environment = options.env || 'production'

  console.log()
  console.log(`  ${c.bold(c.highlight('Application Logs'))}`)
  console.log(`  ${c.dim(`${project.project} / ${environment}`)}`)
  console.log()

  try {
    // Get environment to find container name
    const { environment: env } = await api.environments.get(project.project, environment)

    const apps = env.app || []
    if (apps.length === 0) {
      error('No app deployed in this environment. Run `slipway slide` first.')
    }

    const app = options.app
      ? apps.find(a => a.slug === options.app)
      : apps.find(a => a.isDefault) || apps[0]

    if (!app) {
      error(`App "${options.app}" not found. Available: ${apps.map(a => a.slug).join(', ')}`)
    }
    if (app.status !== 'running') {
      error(`App is not running (status: ${app.status})`)
    }

    // For now, show instructions to view logs directly
    // In a full implementation, we'd stream logs via WebSocket or polling
    console.log(`  ${c.dim('Container:')} ${app.containerName}`)
    console.log()
    console.log(`  ${c.dim('To view logs, run:')}`)
    console.log(`    docker logs ${options.follow ? '-f ' : ''}--tail ${options.tail} ${app.containerName}`)
    console.log()

    // TODO: Implement log streaming via API
  } catch (err) {
    error(err.message)
  }
}

async function showDeploymentLogs(deploymentId) {
  console.log()
  console.log(`  ${c.bold(c.highlight('Deployment Logs'))}`)
  console.log()

  const spin = createSpinner('Fetching logs...').start()

  try {
    const result = await api.deployments.logs(deploymentId, 'all')

    spin.stop()

    console.log(`  ${c.dim('Deployment:')} ${deploymentId}`)
    console.log(`  ${c.dim('Status:')} ${result.status}`)
    console.log()

    if (result.buildLogs) {
      console.log(`  ${c.bold(c.highlight('Build Logs:'))}`)
      console.log(`  ${c.dim('─'.repeat(50))}`)
      console.log(result.buildLogs)
    }

    if (result.deployLogs) {
      console.log(`  ${c.bold(c.highlight('Deploy Logs:'))}`)
      console.log(`  ${c.dim('─'.repeat(50))}`)
      console.log(result.deployLogs)
    }

    if (!result.buildLogs && !result.deployLogs) {
      console.log(`  ${c.dim('No logs available yet.')}`)
    }

    console.log()
  } catch (err) {
    spin.fail('Failed to fetch logs')
    error(err.message)
  }
}
