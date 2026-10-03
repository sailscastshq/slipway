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
    Authentication: ['login', 'logout', 'whoami', 'doctor'],
    Project: ['projects', 'project:update', 'init', 'link'],
    Environments: ['environments', 'environment:create', 'environment:update'],
    Deployment: ['push', 'slide', 'readiness', 'deployments', 'logs'],
    Database: ['db:create', 'db:url'],
    Services: ['services', 'service:review', 'service:create'],
    Backups: ['backup:create', 'backup:list', 'backup:restore'],
    'Env Variables': ['env', 'env:set', 'env:unset'],
    Container: [
      'apps',
      'app:inspect',
      'app:restart',
      'terminal',
      'run',
      'run:arm',
      'run:cancel',
      'run:history'
    ],
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

function usageError(message, code = 'CLI_USAGE') {
  if (
    process.argv.slice(2).some((arg) => /^--(?:json|ndjson)(?:=|$)/.test(arg))
  )
    console.error(JSON.stringify({ type: 'error', error: { code, message } }))
  else console.error(`${c.error('Error:')} ${message}`)
}

async function main() {
  assertSupportedNodeVersion()

  const argv = process.argv.slice(2)
  if (['--version', '-v'].includes(argv[0])) {
    showVersion()
    return
  }
  if (!argv.length || ['--help', '-h'].includes(argv[0])) {
    showHelp()
    return
  }
  const positionals = [argv[0]]

  // Resolve aliases
  let command = positionals[0]
  if (aliases[command]) {
    command = aliases[command]
  }

  const commandDef = commands[command]

  if (!commandDef) {
    usageError(`Unknown command: ${positionals[0]}`, 'CLI_UNKNOWN_COMMAND')
    process.exit(1)
  }

  // Parse command-specific options
  const commandArgs = argv.slice(1) // Skip node, script, command
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
    usageError(err.message, err.code || 'CLI_USAGE')
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
        console.log(
          `    ${short}--${name}${
            opt.type === 'string' ? ' <value>' : ''
          }${def}`
        )
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
  usageError(err.message, err.code || 'CLI_ERROR')
  process.exit(1)
})
