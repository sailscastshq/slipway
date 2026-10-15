const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { loadJobs } = require('sails-hook-quest/lib/core/loader')
const job = require('../../../scripts/run-scheduled-backups')

test('the real scripts directory registers every scheduled job without executing command tools', async () => {
  const appPath = path.resolve(__dirname, '../../..')
  const scripts = path.join(appPath, 'scripts')
  // Fail before importing an accidentally added command-only entry point.
  for (const name of fs
    .readdirSync(scripts)
    .filter((name) => name.endsWith('.js'))) {
    if (name === 'quest-preload-manifest.js') continue // Pure build plugin.
    assert.match(
      fs.readFileSync(path.join(scripts, name), 'utf8'),
      /\bquest\s*:/,
      `${name} must declare a Quest job; command-only tools use .cjs`
    )
  }
  const jobs = await loadJobs({ appPath })
  assert.deepEqual([...jobs.keys()].sort(), [
    'check-for-updates',
    'check-system-databases',
    'expire-bridge-support',
    'maintain-observability',
    'maintain-wake',
    'reconcile-deployments',
    'run-scheduled-backups'
  ])
  assert.equal(jobs.get('run-scheduled-backups').interval, '1 minute')
  assert.equal(jobs.get('run-scheduled-backups').withoutOverlapping, true)
})

async function fixture(t, overrides = {}) {
  const originals = Object.fromEntries(
    ['sails', 'Service', 'Backup'].map((key) => [key, global[key]])
  )
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete global[key]
      else global[key] = value
    }
  })
  const schedule = {
    enabled: true,
    intervalHours: 24,
    retentionCount: 10,
    lastRunAt: 0,
    ...overrides
  }
  const calls = { runs: [], writes: [], creates: [] }
  global.Service = {
    find: async (criteria) =>
      criteria.or
        ? [
            { id: 'managed', type: 'postgresql', name: 'fixture' },
            { id: 'external', type: 'postgresql', name: 'external' },
            { id: 'cache', type: 'redis' }
          ]
        : [],
    isBackupSupported: (type) => type === 'postgresql'
  }
  global.Backup = {
    find: () => ({
      limit: async () => [],
      then: (resolve) => Promise.resolve([]).then(resolve)
    }),
    create: (input) => ({
      fetch: async () => {
        calls.creates.push(input)
        return { id: input.service }
      }
    })
  }
  global.sails = {
    log: { verbose() {}, info() {}, error() {}, warn() {} },
    helpers: {
      setting: {
        get: async () => JSON.stringify(schedule),
        set: async (key, value) =>
          calls.writes.push({ key, value: JSON.parse(value) })
      },
      backup: {
        getStorageConfig: async () => ({}),
        runBackup: async (id) => calls.runs.push(id)
      }
    }
  }
  return { calls, schedule }
}

test('due schedule runs supported services and persists its completion watermark', async (t) => {
  const { calls } = await fixture(t)
  await job.fn()
  assert.deepEqual(calls.runs, ['managed', 'external'])
  assert.ok(
    calls.creates.every(
      (input) => input.type === 'scheduled' && input.status === 'pending'
    )
  )
  assert.equal(calls.writes.length, 1)
  assert.equal(calls.writes[0].key, 'backupSchedule')
  assert.ok(calls.writes[0].value.lastRunAt > 0)
})

for (const schedule of [{ enabled: false }, { lastRunAt: Date.now() }]) {
  test(`schedule skips work when ${
    schedule.enabled === false ? 'disabled' : 'not due'
  }`, async (t) => {
    const { calls } = await fixture(t, schedule)
    await job.fn()
    assert.deepEqual(calls.runs, [])
    assert.deepEqual(calls.writes, [])
  })
}

test('missing storage leaves the schedule watermark unchanged', async (t) => {
  const { calls } = await fixture(t)
  sails.helpers.backup.getStorageConfig = async () => {
    throw new Error('fixture unavailable')
  }
  await job.fn()
  assert.deepEqual(calls.runs, [])
  assert.deepEqual(calls.writes, [])
})
