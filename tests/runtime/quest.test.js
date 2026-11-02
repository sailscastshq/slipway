const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { executeJob } = require('sails-hook-quest/lib/core/executor')
const { createRuntime } = require('sails-hook-quest/lib/core/runtime')
const quest = require('../../config/quest').quest
const consoleConfig = require('../../config/env/console')

test('server Quest jobs reuse a loaded console child with helpers and no resident scheduler or collectors', async (t) => {
  const appPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-quest-worker-')
  )
  const runtime = createRuntime()
  t.after(async () => {
    if (runtime.workerPool) await runtime.workerPool.drain()
    await fs.rm(appPath, { recursive: true, force: true })
  })
  await fs.mkdir(path.join(appPath, 'config', 'env'), { recursive: true })
  await fs.mkdir(path.join(appPath, 'scripts'))
  await fs.mkdir(path.join(appPath, 'api', 'helpers', 'system'), {
    recursive: true
  })
  await fs.mkdir(path.join(appPath, 'api', 'hooks', 'lookout'), {
    recursive: true
  })
  await fs.writeFile(
    path.join(appPath, 'api', 'hooks', 'lookout', 'index.js'),
    `module.exports = function () { return { initialize: function (done) {
      done(new Error('A job child must not start resident collectors'))
    } } }`
  )
  await fs.symlink(
    path.resolve('node_modules'),
    path.join(appPath, 'node_modules')
  )
  await fs.writeFile(
    path.join(appPath, 'package.json'),
    JSON.stringify({
      name: 'slipway-quest-harmless-fixture',
      dependencies: { 'sails-hook-quest': '0.0.10' }
    })
  )
  await fs.writeFile(
    path.join(appPath, '.sailsrc'),
    JSON.stringify({
      hooks: { orm: false, grunt: false, sockets: false, pubsub: false },
      globals: { sails: true, models: true, _: false, async: false },
      log: { level: 'silent' },
      quest: { autoStart: true }
    })
  )
  await fs.writeFile(
    path.join(appPath, 'config', 'env', 'console.js'),
    `module.exports = ${JSON.stringify({ hooks: consoleConfig.hooks })}`
  )
  // The real scheduled wrapper runs only this disposable helper, never SQLite,
  // Docker, object storage, deployment, email, or a provider request.
  await fs.copyFile(
    path.resolve('scripts/check-system-databases.js'),
    path.join(appPath, 'scripts', 'check-system-databases.js')
  )
  await fs.writeFile(
    path.join(appPath, 'api', 'helpers', 'system', 'check-database-storage.js'),
    `module.exports = { friendlyName: 'Fixture database check', fn: async function () {
      sails.fixtureChecks = (sails.fixtureChecks || 0) + 1
      return { checks: sails.fixtureChecks, pid: process.pid,
        environment: sails.config.environment, nodeEnvironment: process.env.NODE_ENV,
        schedulerStarted: sails.config.quest.autoStart,
        sessionLoaded: Boolean(sails.hooks.session), lookoutLoaded: Boolean(sails.hooks.lookout) }
    } }`
  )
  const context = { runtime, config: { ...quest, appPath } }
  const first = await executeJob(
    'check-system-databases',
    { script: 'check-system-databases' },
    {},
    context
  )
  const second = await executeJob(
    'check-system-databases',
    { script: 'check-system-databases' },
    {},
    context
  )
  assert.equal(first.execution, 'worker')
  assert.equal(first.workerGeneration, second.workerGeneration)
  assert.notEqual(first.result.value.pid, process.pid)
  assert.deepEqual(second.result.value, {
    checks: 2,
    pid: first.result.value.pid,
    environment: 'console',
    nodeEnvironment: 'console',
    schedulerStarted: false,
    // Console env flags do not remove Sails builtin session definitions.
    // This fixture preserves that existing behavior; only resident user hooks stop.
    sessionLoaded: true,
    lookoutLoaded: false
  })
})
