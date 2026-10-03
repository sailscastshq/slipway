const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { test } = require('node:test')
const machine = require('machine')
const os = require('node:os')
const { createRequire } = require('node:module')
const { upstreamSource } = require('./docker.cjs')
const {
  fixtureDependencies,
  prepareDependencies,
  verifyDependencies
} = require('./dependencies.cjs')

test('actual fixture dependencies resolve without a root workspace link', async () => {
  const { root } = await upstreamSource()
  const appRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'quest-fixture-resolution-')
  )
  try {
    const layout = {
      appRoot,
      dependencies: fs.realpathSync('node_modules'),
      questRoot: root,
      slipwayRoot: fs.realpathSync('packages/hook')
    }
    fs.writeFileSync(
      path.join(appRoot, 'package.json'),
      JSON.stringify({ private: true, dependencies: fixtureDependencies })
    )
    prepareDependencies(layout)
    const resolved = verifyDependencies(layout)
    assert.deepEqual(Object.keys(resolved), Object.keys(fixtureDependencies))
    assert.equal(
      fs.lstatSync(path.join(appRoot, 'node_modules')).isDirectory(),
      true
    )
    const appRequire = createRequire(path.join(appRoot, 'package.json'))
    assert.equal(typeof appRequire('sails-hook-slipway'), 'function')
    assert.equal(typeof appRequire('sails-hook-quest'), 'function')
    assert.equal(typeof appRequire('sails').lift, 'function')
    assert.equal(typeof appRequire('sails-hook-orm'), 'function')
    assert.equal(
      fs.readlinkSync(path.join(appRoot, 'node_modules/sails-hook-slipway')),
      layout.slipwayRoot
    )
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true })
  }
})

// Real source/schema checks only: no app load, socket, scheduler or job child.
test('real upstream loader preserves aliases, effective defaults and Sails schemas', async () => {
  const { root } = await upstreamSource()
  const loader = require(path.join(root, 'lib/core/loader'))
  const metadata = require(path.join(root, 'lib/core/runtime'))
  const info = metadata.runtimeInfo({ runtime: metadata.createRuntime() })
  for (const name of [
    'childSchedulerSuppression',
    'triggerProvenance',
    'terminalExitCode',
    'terminalSignal',
    'scheduleDiagnostics'
  ])
    assert.equal(info.capabilities[name], true)
  const appPath = path.join(__dirname, 'app')
  const jobs = await loader.loadJobs({
    ...require('./app/config/quest').quest,
    appPath
  })
  const alias = jobs.get('index-from-config'),
    source = metadata.scheduledInputs(alias)
  assert.equal(alias.script, 'rebuild-search-index')
  assert.equal(alias.interval, 600000)
  assert.deepEqual(
    { ...source.values },
    { collection: 'articles', batchSize: 100, dryRun: true }
  )
  assert.equal(source.fields.collection.source, 'job_input')
  assert.equal(source.fields.batchSize.source, 'script_input')
  assert.equal(source.fields.dryRun.source, 'script_input')
  assert.equal(
    metadata.inputMetadata(jobs.get('validated-job').inputSchema).even
      .customValidation,
    true
  )
  assert.equal(
    metadata.inputMetadata(jobs.get('protected-report').inputSchema).accessCode
      .sensitive,
    true
  )
  assert.equal(
    jobs.get('rebuild-search-index').friendlyName,
    'Rebuild search index'
  )
  assert.equal(jobs.get('slow-overlap').script, 'slow-job')
  const scheduler = require(path.join(root, 'lib/core/scheduler'))
  let assessment
  assert.equal(
    scheduler.getNextRunTime(jobs.get('invalid-schedule'), {}, (value) => {
      assessment = value
    }),
    null
  )
  assert.equal(assessment.validation, 'invalid')
  assert.equal(assessment.validationErrors[0].code, 'E_SCHEDULE_CRON')
  assert.equal(
    scheduler.getNextRunTime(jobs.get('expired-schedule'), {}, (value) => {
      assessment = value
    }),
    null
  )
  assert.equal(assessment.validation, 'valid')
  assert.equal(assessment.reason, 'no_future_run')
  assert.equal(
    scheduler.effectiveTimezone(jobs.get('timezone-cron'), { timezone: 'UTC' }),
    'America/New_York'
  )
  assert.equal(
    scheduler.effectiveTimezone(jobs.get('timezone-default'), {
      timezone: 'UTC'
    }),
    null
  )
  assert.ok(
    scheduler.getNextRunTime(jobs.get('timezone-default'), {}, (value) => {
      assessment = value
    }) instanceof Date
  )
  assert.equal(assessment.validation, 'valid')
  for (const job of jobs.values()) assert.ok(job.inputSchema)
  assert.deepEqual(jobs.get('named-exit').inputSchema, {})
  for (const file of fs.readdirSync(path.join(appPath, 'scripts')))
    machine.build(require(path.join(appPath, 'scripts', file))) // Compile; never call business fn.
  const validate = (name, inputs) =>
    machine
      .buildWithCustomUsage({
        def: {
          identity: 'fixture-schema-check',
          sync: true,
          inputs: jobs.get(name).inputSchema,
          fn: (values, exits) => exits.success(values)
        },
        extraArginsTactic: 'error'
      })(inputs)
      .execSync()
  for (const inputs of [
    {
      count: 0,
      enabled: false,
      label: '001',
      payload: { zero: 0, flag: false, nothing: null }
    },
    { count: 0, enabled: false, label: '', payload: null },
    { label: null }
  ])
    assert.deepEqual(validate('typed-report', inputs), {
      count: 7,
      enabled: true,
      label: 'default',
      payload: { omitted: true },
      ...inputs
    })
  assert.throws(() => validate('validated-job', { even: 3 }), {
    code: 'E_INVALID_ARGINS'
  })
  assert.deepEqual(validate('validated-job', { even: 4 }), { even: 4 })
  assert.throws(() => validate('rebuild-search-index', { batchSize: 200 }), {
    code: 'E_INVALID_ARGINS'
  })
})
