import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error } from '../lib/utils.js'

export default async function projectUpdate(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const slug = positionals[0]
  if (!slug) {
    error(
      'Please provide a project slug. Usage: slipway project:update <slug> [options]'
    )
  }

  const updates = {}
  if (options.name !== undefined) updates.name = options.name
  if (options.description !== undefined)
    updates.description = options.description
  if (options.repo !== undefined) updates.repositoryUrl = options.repo

  if (Object.keys(updates).length === 0) {
    error('No updates provided. Use --name, --description, or --repo.')
  }

  try {
    const { project } = await api.projects.update(slug, updates)

    console.log()
    console.log(`${c.success('✓')} Project updated`)
    console.log()
    console.log(`  ${c.dim('Name:')} ${project.name}`)
    console.log(`  ${c.dim('Slug:')} ${project.slug}`)
    if (project.description) {
      console.log(`  ${c.dim('Description:')} ${project.description}`)
    }
    console.log()
  } catch (err) {
    error(err.message)
  }
}
