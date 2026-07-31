#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { c } from './lib/colors.js'
import { assertSupportedNodeVersion } from './lib/runtime.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

// Command aliases (alias → primary command)
const aliases = {
  deploy: 'slide',
  launch: 'slide'
}

const commands = {
  // Auth commands
  login: {
    description: 'Authenticate with your Slipway server',
    options: { server: { type: 'string', short: 's' } }
  },
  logout: {
    description: 'Clear stored credentials',
    options: {}
  },
  whoami: {
    description: 'Show current authenticated user',
    options: {}
  },

  // Project commands
  projects: {
    description: 'List all projects',
    options: {}
  },
  'project:update': {
    description: 'Update a project',
    args: '<slug>',
    options: {
      name: { type: 'string', short: 'n' },
      description: { type: 'string', short: 'd' },
      repo: { type: 'string', short: 'r' }
    }
  },
  init: {
    description: 'Initialize a new Slipway project',
    options: { name: { type: 'string', short: 'n' } }
  },
  link: {
    description: 'Link current directory to an existing project',
    args: '<project>',
    options: {}
  },

  // Environment commands
  environments: {
    description: 'List environments for the current project',
    options: {}
  },
  'environment:create': {
    description: 'Create a new environment',
    args: '<name>',
    options: {
      production: { type: 'boolean', short: 'p' },
      domain: { type: 'string', short: 'd' },
      from: { type: 'string', short: 'f' }
    }
  },
  'environment:update': {
    description: 'Update an environment',
    args: '<slug>',
    options: {
      name: { type: 'string', short: 'n' },
      domain: { type: 'string', short: 'd' },
      production: { type: 'boolean', short: 'p' }
    }
  },

  // Deployment commands
  push: {
    description: 'Push source code without deploying',
    options: {}
  },
  slide: {
    description: 'Push and deploy the current project',
    aliases: ['deploy', 'launch'],
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' },
      message: { type: 'string', short: 'm' }
    }
  },
  deployments: {
    description: 'List recent deployments',
    options: {
      env: { type: 'string', short: 'e' },
      limit: { type: 'string', short: 'n', default: '10' }
    }
  },
  logs: {
    description: 'View application logs',
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' },
      follow: { type: 'boolean', short: 'f' },
      tail: { type: 'string', short: 'n', default: '100' },
      deployment: { type: 'string', short: 'd' }
    }
  },

  // Database commands
  'db:create': {
    description: 'Create a new database service',
    args: '<name>',
    options: {
      type: { type: 'string', short: 't', default: 'postgresql' },
      version: { type: 'string', short: 'v' },
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },
  'db:url': {
    description: 'Get database connection URL',
    args: '<name>',
    options: {
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },

  // Service commands
  services: {
    description: 'List all services',
    options: {
      env: { type: 'string', short: 'e' }
    }
  },

  // Environment variable commands
  env: {
    description: 'List environment variables',
    options: {
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },
  'env:set': {
    description: 'Set environment variables (KEY=value)',
    args: '<pairs...>',
    options: {
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },
  'env:unset': {
    description: 'Remove environment variables',
    args: '<keys...>',
    options: {
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },

  // Backup commands
  'backup:create': {
    description: 'Create a manual database backup',
    args: '<service-name>',
    options: { env: { type: 'string', short: 'e', default: 'production' } }
  },
  'backup:list': {
    description: 'List backups for a database service',
    args: '<service-name>',
    options: { env: { type: 'string', short: 'e', default: 'production' } }
  },
  'backup:restore': {
    description: 'Restore a database backup',
    args: '<backup-id>',
    options: {}
  },

  // Admin commands
  'audit-log': {
    description: 'View audit log entries',
    options: {
      page: { type: 'string', short: 'p', default: '1' },
      limit: { type: 'string', short: 'n', default: '20' }
    }
  },

  // Container access
  terminal: {
    description: 'Open a terminal session in the running container',
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' }
    }
  },
  run: {
    description: 'Run a command in the container',
    args: '<command...>',
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' }
    }
  }
}

function showHelp() {
  console.log()
  console.log(`  ${c.bold(c.highlight('Slipway'))} ${c.dim(`v${pkg.version}`)}`)
  console.log(`  ${c.dim('Deploy Sails apps with ease')}`)
  console.log()
  console.log('  Usage: slipway <command> [options]')
  console.log()
  console.log('  Commands:')
  console.log()

  // Group commands
  const groups = {
    Authentication: ['login', 'logout', 'whoami'],
    Project: ['projects', 'project:update', 'init', 'link'],
    Environments: ['environments', 'environment:create', 'environment:update'],
    Deployment: ['push', 'slide', 'deployments', 'logs'],
    Database: ['db:create', 'db:url'],
    Services: ['services'],
    Backups: ['backup:create', 'backup:list', 'backup:restore'],
    'Env Variables': ['env', 'env:set', 'env:unset'],
    Container: ['terminal', 'run'],
    Admin: ['audit-log']
  }

  for (const [groupName, cmds] of Object.entries(groups)) {
    console.log(`  ${c.dim(groupName)}`)
    for (const cmd of cmds) {
      const def = commands[cmd]
      const args = def.args ? ` ${def.args}` : ''
      const aliasText = def.aliases
        ? ` ${c.dim(`(or: ${def.aliases.join(', ')})`)}`
        : ''
      console.log(`    ${c.highlight(cmd)}${c.dim(args)}${aliasText}`)
      console.log(`      ${def.description}`)
    }
    console.log()
  }

  console.log('  Options:')
  console.log(`    ${c.dim('-h, --help')}     Show help`)
  console.log(`    ${c.dim('-v, --version')}  Show version`)
  console.log()
}

function showVersion() {
  console.log(`slipway v${pkg.version}`)
}

async function main() {
  assertSupportedNodeVersion()

  // Parse global options first
  const { values: globalValues, positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    }
  })

  if (globalValues.version) {
    showVersion()
    return
  }

  if (globalValues.help || positionals.length === 0) {
    showHelp()
    return
  }

  // Resolve aliases
  let command = positionals[0]
  if (aliases[command]) {
    command = aliases[command]
  }

  const commandDef = commands[command]

  if (!commandDef) {
    console.error(`${c.error('Error:')} Unknown command: ${positionals[0]}`)
    console.error(
      `Run ${c.highlight('slipway --help')} for available commands.`
    )
    process.exit(1)
  }

  // Parse command-specific options
  const commandArgs = process.argv.slice(3) // Skip node, script, command
  let parsed

  try {
    parsed = parseArgs({
      args: commandArgs,
      allowPositionals: true,
      options: {
        ...commandDef.options,
        help: { type: 'boolean', short: 'h' }
      }
    })
  } catch (err) {
    console.error(`${c.error('Error:')} ${err.message}`)
    process.exit(1)
  }

  if (parsed.values.help) {
    console.log()
    console.log(
      `  ${c.bold(command)}${
        commandDef.args ? ` ${c.dim(commandDef.args)}` : ''
      }`
    )
    if (commandDef.aliases) {
      console.log(`  ${c.dim(`Aliases: ${commandDef.aliases.join(', ')}`)}`)
    }
    console.log(`  ${commandDef.description}`)
    console.log()
    if (Object.keys(commandDef.options).length > 0) {
      console.log('  Options:')
      for (const [name, opt] of Object.entries(commandDef.options)) {
        const short = opt.short ? `-${opt.short}, ` : '    '
        const def = opt.default ? ` (default: ${opt.default})` : ''
        console.log(`    ${short}--${name}${def}`)
      }
      console.log()
    }
    return
  }

  // Apply defaults
  const options = { ...parsed.values }
  for (const [name, opt] of Object.entries(commandDef.options)) {
    if (options[name] === undefined && opt.default !== undefined) {
      options[name] = opt.default
    }
  }

  // Map command to file name (handle colons)
  const commandFile = command.replace(':', '-')

  try {
    const module = await import(`./commands/${commandFile}.js`)
    await module.default(options, parsed.positionals)
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(
        `${c.error('Error:')} Command '${command}' is not yet implemented.`
      )
      process.exit(1)
    }
    throw err
  }
}

main().catch((err) => {
  console.error(`${c.error('Error:')} ${err.message}`)
  process.exit(1)
})
