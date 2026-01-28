import { join, basename } from 'node:path'
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { saveProjectConfig, getProjectConfig, isLoggedIn } from '../lib/config.js'
import { error, createSpinner, warn } from '../lib/utils.js'
import { prompt, confirm } from '../lib/prompt.js'

export default async function init(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  // Check if already initialized
  const existing = getProjectConfig()
  if (existing) {
    error(`Already linked to project "${existing.project}". Use \`slipway link\` to switch projects.`)
  }

  // Check for package.json to determine project name
  const packageJsonPath = join(process.cwd(), 'package.json')
  let suggestedName = basename(process.cwd())

  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      suggestedName = pkg.name || suggestedName
    } catch {
      // Ignore parsing errors
    }
  }

  console.log()
  console.log(`  ${c.bold(c.highlight('Initialize Slipway Project'))}`)
  console.log()

  // Get project details
  const projectName = options.name || await prompt('  Project name', suggestedName)

  // Check for Dockerfile
  const dockerfilePath = join(process.cwd(), 'Dockerfile')
  const hasDockerfile = existsSync(dockerfilePath)

  if (!hasDockerfile) {
    console.log()
    warn('No Dockerfile found in current directory.')
    console.log(`  ${c.dim('Slipway requires a Dockerfile to build and deploy your app.')}`)
    console.log()

    const proceed = await confirm('  Continue anyway?', true)

    if (!proceed) {
      console.log(`  ${c.dim('Run `slipway init` again after adding a Dockerfile.')}`)
      return
    }
  }

  const spin = createSpinner('Creating project...').start()

  try {
    // Create project via API
    const { project } = await api.projects.create({
      name: projectName,
      dockerfilePath: 'Dockerfile'
    })

    // Save project config
    saveProjectConfig({
      project: project.slug,
      projectId: project.id
    })

    spin.succeed('Project created')
    console.log()
    console.log(`  ${c.dim('Project:')} ${project.name}`)
    console.log(`  ${c.dim('Slug:')} ${project.slug}`)
    console.log(`  ${c.dim('Environment:')} production`)
    console.log()
    console.log(`  ${c.dim('Run')} ${c.highlight('slipway deploy')} ${c.dim('to deploy your app.')}`)
    console.log()

    // Add .slipway.json to .gitignore if it exists
    const gitignorePath = join(process.cwd(), '.gitignore')
    if (existsSync(gitignorePath)) {
      const gitignore = readFileSync(gitignorePath, 'utf8')
      if (!gitignore.includes('.slipway.json')) {
        appendFileSync(gitignorePath, '\n# Slipway\n.slipway.json\n')
      }
    }
  } catch (err) {
    spin.fail('Failed to create project')
    error(err.message)
  }
}
