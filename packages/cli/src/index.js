#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { c } from './lib/colors.js'
import { assertSupportedNodeVersion } from './lib/runtime.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

import { aliases, commands } from './lib/commands.js'

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
    Deployment: ['push', 'slide', 'readiness', 'deployments', 'logs'],
    Database: ['db:create', 'db:url'],
    Services: ['services', 'service:review', 'service:create'],
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
