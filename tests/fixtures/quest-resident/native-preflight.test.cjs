const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const {
  PIN,
  LIMITS,
  requireCI,
  childEnvironment,
  dashboardOptions,
  assertLoopback,
  residentData
} = require('./native-config.cjs')
const { createNativeFixture, prepareWeb } = require('./native-fixture.cjs')

test('direct resident transport unwraps the real socket envelope and retains error codes', () => {
  const snapshot = { runtimeId: 'native-runtime', jobs: [] }
  const run = { runId: 'native-run', runtimeId: 'native-runtime' }
  assert.equal(residentData({ ok: true, data: snapshot }), snapshot)
  assert.equal(residentData({ ok: true, data: { run } }).run, run)
  assert.throws(
    () =>
      residentData({
        ok: false,
        error: { code: 'QUEST_RUN_UNAVAILABLE', message: 'No retained run' }
      }),
    { code: 'QUEST_RUN_UNAVAILABLE' }
  )
  assert.throws(() => residentData({ runtimeId: 'unwrapped-by-mistake' }), {
    code: 'QUEST_UNAVAILABLE'
  })
})

test('native proof fails closed before any startup unless both CI gates are explicit', async () => {
  for (const env of [
    {},
    { CI: 'true' },
    { SLIPWAY_QUEST_RESTART_CI: '1' },
    { CI: '1', SLIPWAY_QUEST_RESTART_CI: '1' }
  ])
    await assert.rejects(
      createNativeFixture({ env }),
      /requires CI=true|requires SLIPWAY_QUEST_RESTART_CI=1/
    )
  assert.doesNotThrow(() =>
    requireCI({ CI: 'true', SLIPWAY_QUEST_RESTART_CI: '1' })
  )
})

test('child environment is an explicit credential-free allowlist with private home/tmp', () => {
  const env = childEnvironment({
    root: '/private/fixture',
    context: '/private/fixture/context.json',
    evidence: '/private/fixture/evidence.jsonl',
    appId: 7,
    deploymentId: 9
  })
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      'CI',
      'HOME',
      'LANG',
      'NODE_ENV',
      'PATH',
      'QUEST_NATIVE_CONTEXT',
      'QUEST_NATIVE_EVIDENCE',
      'SLIPWAY_APP_ID',
      'SLIPWAY_DEPLOYMENT_ID',
      'SLIPWAY_QUEST_RESTART_CI',
      'TMPDIR',
      'TZ'
    ].sort()
  )
  for (const key of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'SLIPWAY_TELEMETRY_URL',
    'SLIPWAY_TELEMETRY_TOKEN',
    'HTTPS_PROXY'
  ])
    assert.equal(Object.hasOwn(env, key), false)
  assert.equal(env.HOME, '/private/fixture/home')
  assert.equal(env.TMPDIR, '/private/fixture/tmp')
  assert.equal(env.SLIPWAY_APP_ID, '7')
  assert.equal(env.SLIPWAY_DEPLOYMENT_ID, '9')
})

test('dashboard generations preserve all four unique SQLite stores using actual Sounding inherit semantics', () => {
  const { resolveDatastore } = require('sounding/lib/resolve-datastore')
  const a = dashboardOptions({
    repo: '/repo',
    root: '/private/unique',
    generation: 'A'
  })
  const b = dashboardOptions({
    repo: '/repo',
    root: '/private/unique',
    generation: 'B',
    port: 12345
  })
  assert.equal(a.port, 0)
  assert.equal(b.port, 12345)
  assert.equal(a.explicitHost, '127.0.0.1')
  assert.equal(b.host, '127.0.0.1')
  assert.equal(a.environment, 'test')
  assert.equal(a.models.migrate, 'drop')
  assert.equal(b.models.migrate, 'safe')
  assert.deepEqual(a.datastores, b.datastores)
  assert.equal(
    new Set(Object.values(a.datastores).map((store) => store.url)).size,
    4
  )
  assert.deepEqual(Object.keys(a.datastores), [
    'default',
    'observability',
    'analytics',
    'cache'
  ])
  for (const options of [a, b]) {
    const before = JSON.stringify(options)
    const state = resolveDatastore({
      sails: { config: options },
      soundingConfig: options.sounding
    })
    assert.equal(state.mode, 'inherit')
    assert.equal(state.managed, false)
    assert.equal(JSON.stringify(options), before)
    for (const store of Object.values(options.datastores)) {
      assert.equal(store.adapter, 'sails-sqlite')
      assert.ok(store.url.startsWith('/private/unique/'))
      assert.notEqual(store.url, ':memory:')
    }
  }
})

test('native destinations reject non-loopback HTTP and carry finite execution bounds', () => {
  assert.equal(
    assertLoopback('http://127.0.0.1:12345/health').hostname,
    '127.0.0.1'
  )
  for (const url of [
    'http://localhost:12345',
    'https://127.0.0.1:12345',
    'http://0.0.0.0:12345',
    'http://example.com:12345',
    'http://token@127.0.0.1:12345',
    'http://127.0.0.1:12345?token=bad'
  ])
    assert.throws(() => assertLoopback(url))
  assert.deepEqual(LIMITS, {
    lifetimeMs: 180000,
    bytes: 2097152,
    starts: 64,
    loads: 70,
    expectedStarts: 41,
    expectedLoads: 42,
    parallel: 4
  })
})

test('source-only Sails discovery finds complete native web hooks without initializing anything', async () => {
  const questRoot = process.env.SLIPWAY_QUEST_UPSTREAM_ROOT
  assert.ok(
    questRoot,
    'Explicit restored upstream source is required for the pure loader check'
  )
  assert.equal(process.env.SLIPWAY_QUEST_UPSTREAM_SHA, PIN)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(questRoot, 'package.json'), 'utf8'))
      .name,
    'sails-hook-quest'
  )
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-native-source-'))
  const appRoot = path.join(root, 'web')
  try {
    prepareWeb({
      appRoot,
      repo: path.resolve(__dirname, '../../..'),
      source: { root: fs.realpathSync(questRoot) }
    })
    const rc = JSON.parse(
      fs.readFileSync(path.join(appRoot, '.sailsrc'), 'utf8')
    )
    assert.equal(
      Object.hasOwn(rc, 'loadHooks'),
      false,
      'Do not replace normal built-in hook discovery with a partial list'
    )
    assert.equal(rc.hooks.http, undefined)
    assert.equal(rc.hooks.sockets, false)
    const appRequire = createRequire(path.join(appRoot, 'package.json'))
    const manifest = appRequire('./package.json')
    assert.deepEqual(
      manifest.scripts,
      {},
      'The installed Sails CLI requires a scripts dictionary before source-script discovery'
    )
    assert.equal(manifest.scripts['rebuild-search-index'], undefined)
    const app = new (appRequire('sails').Sails)()
    app.hooks = {}
    app.config = {
      ...rc,
      appPath: appRoot,
      paths: { hooks: path.join(appRoot, 'api/hooks') }
    }
    app.log = appRequire('captains-log')({ level: 'silent' })
    const loader = appRequire('sails/lib/hooks/moduleloader')(app)
    const discovered = await new Promise((resolve, reject) =>
      loader.loadUserHooks((error, hooks) =>
        error ? reject(error) : resolve(hooks)
      )
    )
    assert.deepEqual(Object.keys(discovered).sort(), [
      'native-probe',
      'orm',
      'quest',
      'slipway'
    ])
    assert.equal(discovered.quest, appRequire('sails-hook-quest'))
    assert.equal(discovered.slipway, appRequire('sails-hook-slipway'))
    assert.equal(discovered.orm, appRequire('sails-hook-orm'))
    assert.equal(app.quest, undefined)
    assert.deepEqual(app.hooks, {})
    assert.equal(fs.existsSync(path.join(appRoot, '.tmp')), false)
    const http = require(path.join(appRoot, 'config/http'))
    assert.equal(http.port, 0)
    assert.equal(http.explicitHost, '127.0.0.1')
    assert.equal(typeof http.routes['GET /health'], 'function')

    const config = require(path.join(appRoot, 'config/quest')).quest
    assert.equal(config.autoStart, false)
    const sourceLoader = require(path.join(questRoot, 'lib/core/loader'))
    const jobs = await sourceLoader.loadJobs({ ...config, appPath: appRoot })
    assert.equal(jobs.size, 39)
    const machine = appRequire('machine')
    for (let index = 0; index < 36; index++) {
      const job = jobs.get(`telemetry-burst-${index}`)
      assert.equal(job.script, 'telemetry-burst')
      assert.deepEqual(job.inputSchema, {
        label: { type: 'string', required: true, maxLength: 80 }
      })
      const validate = machine.buildWithCustomUsage({
        def: {
          identity: 'native-burst-schema-check',
          sync: true,
          inputs: job.inputSchema,
          fn: (values, exits) => exits.success(values)
        },
        extraArginsTactic: 'error'
      })
      assert.deepEqual(validate({ label: `burst-${index}` }).execSync(), {
        label: `burst-${index}`
      })
      assert.throws(() => validate({}).execSync(), { code: 'E_INVALID_ARGINS' })
    }
    for (const script of fs.readdirSync(path.join(appRoot, 'scripts')))
      machine.build(require(path.join(appRoot, 'scripts', script))) // Compile only; never run a job.
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
