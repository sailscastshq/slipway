import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, table, requireProject, formatDate } from '../lib/utils.js'

export default async function environments() {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()

  console.log()
  console.log(`  ${c.bold(c.highlight('Environments'))}`)
  console.log(`  ${c.dim(project.project)}`)
  console.log()

  try {
    const { environments } = await api.environments.list(project.project)

    if (environments.length === 0) {
      console.log(`  ${c.dim('No environments yet. Run `slipway environment:create` to create one.')}`)
      console.log()
      return
    }

    const rows = environments.map(env => [
      env.name,
      c.dim(env.slug),
      env.isProduction ? c.warn('production') : c.info('staging'),
      env.domain || c.dim('—'),
      env.app ? c.success('running') : c.dim('no app'),
      formatDate(env.createdAt)
    ])

    table(
      ['Name', 'Slug', 'Type', 'Domain', 'Status', 'Created'],
      rows
    )

    console.log()
    console.log(`  ${c.dim(`${environments.length} environment${environments.length !== 1 ? 's' : ''}`)}`)
    console.log()
  } catch (err) {
    error(err.message)
  }
}
