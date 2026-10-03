// Disposable worker only: read-only installed dependencies and explicit upstream
// source, tmpfs app state, no network, no install/download and no customer jobs.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const {
  fixtureDependencies,
  prepareDependencies,
  verifyDependencies
} = require('./dependencies.cjs')
assert.equal(process.env.SLIPWAY_QUEST_FIXTURE, '1')
assert.equal(process.env.NODE_ENV, 'staging')
fs.cpSync('/host/tests/fixtures/quest-resident/app', '/app', {
  recursive: true
})
const layout = {
  appRoot: '/app',
  dependencies: '/fixture/node_modules',
  questRoot: '/fixture/node_modules/sails-hook-quest',
  slipwayRoot: '/fixture/packages/hook'
}
prepareDependencies(layout)
fs.writeFileSync(
  '/app/package.json',
  JSON.stringify({
    private: true,
    scripts: {},
    dependencies: fixtureDependencies
  })
)
fs.writeFileSync(
  '/app/.sailsrc',
  JSON.stringify({
    loadHooks: [
      'moduleloader',
      'userconfig',
      'userhooks',
      'helpers',
      'orm',
      'quest',
      'slipway',
      'fixture-probe'
    ],
    models: { migrate: 'safe' },
    log: { level: 'error', noShip: true }
  })
)
console.log(
  '[Quest fixture] Actual dependency resolution',
  verifyDependencies(layout)
)
const {
  startTicks
} = require('/fixture/packages/hook/lib/helm-runtime-contract')
fs.writeFileSync(
  '/tmp/quest-fixture-supervisor.json',
  JSON.stringify({
    pid: process.pid,
    startTicks: startTicks(fs.readFileSync('/proc/self/stat', 'utf8'))
  })
)
let child,
  restarting = false,
  restarts = 0
function abortOwnedFixture(reason) {
  console.error('[Quest fixture safety limit]', reason)
  restarting = false
  child?.kill('SIGKILL')
  // Exiting this main process stops only this uniquely owned container.
  process.exit(78)
}
setInterval(() => {
  const file = '/tmp/quest-fixture-evidence.jsonl'
  if (!fs.existsSync(file)) return
  if (fs.statSync(file).size > 256 * 1024)
    return abortOwnedFixture('Evidence exceeded 256 KiB')
  let loads = 0,
    starts = 0
  for (const line of fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.kind === 'sails-load') loads++
    if (event.kind === 'quest:start') starts++
  }
  if (loads > 40 || starts > 40)
    abortOwnedFixture(
      `Unexpected scheduler/child multiplication: ${loads} loads, ${starts} starts`
    )
}, 100).unref()
setTimeout(
  () => abortOwnedFixture('Four-minute fixture lifetime exceeded'),
  240000
).unref()
function start() {
  fs.rmSync('/tmp/quest-resident-ready.json', { force: true })
  child = spawn(process.execPath, ['app.js'], {
    cwd: '/app',
    stdio: 'inherit',
    env: process.env
  })
  child.once('error', (error) => {
    console.error('[Quest fixture]', error.message)
    process.exit(1)
  })
  child.once('exit', (code, signal) => {
    console.log('[Quest fixture] Resident exited', { code, signal })
    if (restarting) {
      restarting = false
      start()
    } else process.exit(code || 1)
  })
}
process.on('SIGUSR2', () => {
  assert.equal(restarts++, 0, 'Only one deliberate restart is permitted')
  restarting = true
  // The child handle establishes ownership. No host process search/signals.
  child.kill('SIGKILL')
})
start()
