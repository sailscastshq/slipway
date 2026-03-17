import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, createSpinner } from '../lib/utils.js'

export default async function dbCreate(options, positionals) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const name = positionals[0]
  if (!name) {
    error('Please provide a database name. Usage: slipway db:create <name>')
  }

  const project = requireProject()
  const environment = options.env || 'production'
  const dbType = options.type || 'postgresql'
  const version = options.version || 'latest'

  console.log()
  console.log(`  ${c.bold(c.highlight('Create Database'))}`)
  console.log()

  const spin = createSpinner(`Creating ${dbType} database "${name}"...`).start()

  try {
    const { service } = await api.services.create(
      project.project,
      environment,
      {
        name,
        type: dbType,
        version
      }
    )

    spin.succeed('Database created')
    console.log()
    console.log(`  ${c.dim('Name:')} ${service.name}`)
    console.log(`  ${c.dim('Type:')} ${service.type}`)
    console.log(`  ${c.dim('Version:')} ${service.version}`)
    console.log(`  ${c.dim('Environment:')} ${environment}`)
    console.log()

    if (service.connectionUrl) {
      console.log(`  ${c.dim('Connection URL:')}`)
      console.log(`  ${c.highlight(service.connectionUrl)}`)
      console.log()
    }

    console.log(
      `  ${c.dim(
        'The connection URL has been added to your environment variables.'
      )}`
    )
    console.log(
      `  ${c.dim('Use')} ${c.highlight(`slipway db:url ${name}`)} ${c.dim(
        'to retrieve it later.'
      )}`
    )
    console.log()
  } catch (err) {
    spin.fail('Failed to create database')
    error(err.message)
  }
}
