import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, table, statusColor } from '../lib/utils.js'

export default async function services(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()

  console.log()
  console.log(`  ${c.bold(c.highlight('Services'))}`)
  console.log()

  try {
    const { environments } = await api.environments.list(project.project)

    // Filter by environment if specified
    const targetEnvs = options.env
      ? environments.filter(e => e.slug === options.env)
      : environments

    if (targetEnvs.length === 0) {
      console.log(`  ${c.dim('No environments found.')}`)
      return
    }

    const allServices = []

    for (const env of targetEnvs) {
      const { services: envServices } = await api.services.list(project.project, env.slug)
      if (envServices) {
        envServices.forEach(s => {
          allServices.push({
            ...s,
            environment: env.slug
          })
        })
      }
    }

    if (allServices.length === 0) {
      console.log(`  ${c.dim('No services found.')}`)
      console.log(`  ${c.dim('Run')} ${c.highlight('slipway db:create <name>')} ${c.dim('to create a database.')}`)
      console.log()
      return
    }

    const rows = allServices.map(s => [
      s.name,
      s.type,
      s.version || '-',
      s.environment,
      statusColor(s.status)
    ])

    table(
      ['Name', 'Type', 'Version', 'Env', 'Status'],
      rows
    )

    console.log()
  } catch (err) {
    error(err.message)
  }
}
