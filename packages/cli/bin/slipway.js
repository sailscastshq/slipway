#!/usr/bin/env node

import { program } from 'commander'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

program
  .name('slipway')
  .description('The Sails-native deployment platform')
  .version(pkg.version)

// Apps
program
  .command('apps:list')
  .description('List all applications')
  .action(async () => {
    const { list } = await import('../commands/apps.js')
    await list()
  })

program
  .command('apps:create <name>')
  .description('Create a new application')
  .action(async (name) => {
    const { create } = await import('../commands/apps.js')
    await create(name)
  })

// Deploy
program
  .command('deploy [app]')
  .description('Deploy an application')
  .option('-b, --branch <branch>', 'Branch to deploy', 'main')
  .action(async (app, options) => {
    const { deploy } = await import('../commands/deploy.js')
    await deploy(app, options)
  })

// Console
program
  .command('console <app>')
  .description('Open Sails console for an application')
  .option('--readonly', 'Read-only mode')
  .action(async (app, options) => {
    const { console: sailsConsole } = await import('../commands/console.js')
    await sailsConsole(app, options)
  })

// Postgres
program
  .command('postgres:create <name>')
  .description('Create a PostgreSQL database')
  .action(async (name) => {
    const { create } = await import('../commands/postgres.js')
    await create(name)
  })

program
  .command('postgres:link <database> <app>')
  .description('Link a database to an application')
  .action(async (database, app) => {
    const { link } = await import('../commands/postgres.js')
    await link(database, app)
  })

// Redis
program
  .command('redis:create <name>')
  .description('Create a Redis instance')
  .action(async (name) => {
    const { create } = await import('../commands/redis.js')
    await create(name)
  })

program
  .command('redis:link <instance> <app>')
  .description('Link a Redis instance to an application')
  .action(async (instance, app) => {
    const { link } = await import('../commands/redis.js')
    await link(instance, app)
  })

// Logs
program
  .command('logs <app>')
  .description('View application logs')
  .option('-t, --tail', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '100')
  .action(async (app, options) => {
    const { logs } = await import('../commands/logs.js')
    await logs(app, options)
  })

// Login
program
  .command('login')
  .description('Login to Slipway server')
  .action(async () => {
    const { login } = await import('../commands/auth.js')
    await login()
  })

// Update
program
  .command('update')
  .description('Update Slipway to the latest version')
  .action(async () => {
    const { update } = await import('../commands/update.js')
    await update()
  })

program.parse()
