import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, table, statusColor, formatDate } from '../lib/utils.js'

export default async function deployments(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()

  console.log()
  console.log(`  ${c.bold(c.highlight('Recent Deployments'))}`)
  console.log()

  try {
    // Get environments first
    const { environments } = await api.environments.list(project.project)

    // Filter by environment if specified
    const targetEnvs = options.env
      ? environments.filter(e => e.slug === options.env)
      : environments

    if (targetEnvs.length === 0) {
      console.log(`  ${c.dim('No environments found.')}`)
      return
    }

    // Collect deployments from each environment
    const allDeployments = []
    for (const env of targetEnvs) {
      const { environment } = await api.environments.get(project.project, env.slug)
      if (environment.deployments) {
        environment.deployments.forEach(d => {
          allDeployments.push({
            ...d,
            environment: env.slug
          })
        })
      }
    }

    // Sort by date and limit
    allDeployments.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const limited = allDeployments.slice(0, parseInt(options.limit) || 10)

    if (limited.length === 0) {
      console.log(`  ${c.dim('No deployments yet. Run `slipway slide` to create one.')}`)
      return
    }

    const rows = limited.map(d => [
      String(d.id),
      statusColor(d.status),
      d.environment,
      d.gitBranch || '-',
      d.gitCommit ? d.gitCommit.substring(0, 7) : '-',
      formatDate(d.createdAt)
    ])

    table(
      ['ID', 'Status', 'Env', 'Branch', 'Commit', 'Date'],
      rows
    )

    console.log()
  } catch (err) {
    error(err.message)
  }
}
