import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, table, formatDate } from '../lib/utils.js'

export default async function projects() {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  console.log()
  console.log(`  ${c.bold(c.highlight('Projects'))}`)
  console.log()

  try {
    const { projects } = await api.projects.list()

    if (projects.length === 0) {
      console.log(`  ${c.dim('No projects yet. Run `slipway init` to create one.')}`)
      console.log()
      return
    }

    const rows = projects.map(p => [
      p.name,
      c.dim(p.slug),
      p.environments ? `${p.environments.length}` : '0',
      formatDate(p.updatedAt)
    ])

    table(
      ['Name', 'Slug', 'Envs', 'Last updated'],
      rows
    )

    console.log()
    console.log(`  ${c.dim(`${projects.length} project${projects.length !== 1 ? 's' : ''}`)}`)
    console.log()
  } catch (err) {
    error(err.message)
  }
}
