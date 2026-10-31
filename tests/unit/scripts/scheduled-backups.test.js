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
  for (const name of fs.readdirSync(scripts)) {
    assert.equal(
      path.extname(name),
      '.js',
      `${name}: utilities belong in tools/`
    )
    assert.match(
      fs.readFileSync(path.join(scripts, name), 'utf8'),
      /\bquest\s*:/,
      `${name} must declare a Quest job; command-only tools belong in tools/`
    )
  }
  const jobs = await loadJobs({ appPath })
  assert.equal(
    Object.keys(require.cache).some((file) =>
      file.startsWith(path.join(appPath, 'tools') + path.sep)
    ),
    false,
    'Quest discovery must not import utilities'
  )
  assert.deepEqual([...jobs.keys()].sort(), [
    'archive-update-backups',
    'check-for-updates',
    'check-system-databases',
    'expire-bridge-support',
    'maintain-observability',
    'maintain-wake',
    'reconcile-deployments',
    'retain-build-cache',
    'retain-deployment-images',
    'run-ci-checks',
    'run-scheduled-backups'
  ])
  assert.equal(
    jobs.get('retain-deployment-images').friendlyName,
    'Clean up deployment images'
  )
  assert.deepEqual(jobs.get('retain-deployment-images').scriptInputs, {
    preview: false
  })
  assert.equal(jobs.get('retain-build-cache').cron, '17 * * * *')
  assert.deepEqual(jobs.get('retain-build-cache').scriptInputs, {
    preview: false
  })
  assert.equal(jobs.get('archive-update-backups').interval, '5 minutes')
  assert.equal(jobs.get('archive-update-backups').withoutOverlapping, true)
  assert.equal(jobs.get('run-ci-checks').interval, '1 minute')
  assert.equal(jobs.get('run-ci-checks').withoutOverlapping, true)
  assert.equal(jobs.get('run-scheduled-backups').interval, '1 minute')
  assert.equal(jobs.get('run-scheduled-backups').withoutOverlapping, true)
})

test('CI scheduling stays inert during discovery and delegates execution and failure to the bounded queue helper', async (t) => {
  const file = require.resolve('../../../scripts/run-ci-checks')
  const cached = require.cache[file]
  const previous = global.sails
  let calls = 0
  global.sails = {
    helpers: {
      ci: {
        runQueuedChecks: async () => {
          calls++
        }
      }
    }
  }
  delete require.cache[file]
  t.after(() => {
    if (previous === undefined) delete global.sails
    else global.sails = previous
    if (cached) require.cache[file] = cached
    else delete require.cache[file]
  })
  const ciJob = require(file)
  assert.equal(calls, 0, 'Loading the job must not start CI')
  assert.deepEqual(ciJob.quest, {
    interval: '1 minute',
    withoutOverlapping: true
  })
  await ciJob.fn()
  assert.equal(calls, 1)
  const failure = new Error('queue ownership unavailable')
  global.sails.helpers.ci.runQueuedChecks = async () => {
    throw failure
  }
  await assert.rejects(ciJob.fn(), (error) => error === failure)
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
