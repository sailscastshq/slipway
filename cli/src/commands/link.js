import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { saveProjectConfig, isLoggedIn } from '../lib/config.js'
import { error, createSpinner } from '../lib/utils.js'

export default async function link(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const projectSlug = positionals[0]

  if (!projectSlug) {
    error('Please provide a project slug. Usage: slipway link <project-slug>')
  }

  const spin = createSpinner(`Linking to project "${projectSlug}"...`).start()

  try {
    // Verify project exists and user has access
    const { project } = await api.projects.get(projectSlug)

    // Save project config
    saveProjectConfig({
      project: project.slug,
      projectId: project.id
    })

    spin.succeed('Project linked')
    console.log()
    console.log(`  ${c.dim('Project:')} ${project.name}`)
    console.log(`  ${c.dim('Slug:')} ${project.slug}`)
    console.log()
    console.log(`  ${c.dim('Run')} ${c.highlight('slipway deploy')} ${c.dim('to deploy your app.')}`)
    console.log()
  } catch (err) {
    spin.fail('Failed to link project')
    if (err.statusCode === 404) {
      error(`Project "${projectSlug}" not found. Check the project slug and try again.`)
    }
    error(err.message)
  }
}
