const { test } = require('sounding')
const resolveContext = require('../../../../api/lib/helm-app-context')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const runtime = require('../../../../api/lib/helm-runtime')
const {
  registerHelmRuntime
} = require('../../../../packages/hook/lib/helm-runtime-contract')
const fingerprintHelmDatastores = require('../../../../packages/hook/lib/helm-config-fingerprint')
const expectedHelmRuntime = require('../../../../api/lib/helm-expected-runtime')

test('Helm requires the contract for a current deployment with the new hook', async ({
  expect
}) => {
  const app = { id: 7, currentDeployment: { id: 99 } }
  const current = await expectedHelmRuntime(app, async () => ({
    hookVersion: '0.0.11',
    deployment: '99'
  }))
  expect(current).toEqual({ appId: '7', deploymentId: '99', required: true })
  const old = await expectedHelmRuntime(app, async () => ({
    hookVersion: '0.0.10',
    deployment: '99'
  }))
  expect(old.required).toBe(false)
  const rolledBack = await expectedHelmRuntime(app, async () => ({
    hookVersion: '0.0.11',
    deployment: '98'
  }))
  expect(rolledBack.required).toBe(false)
})

test('Helm uses a live deployment contract for custom entrypoints and rejects stale processes', ({
  expect
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-contract-'))
  const procRoot = path.join(root, 'proc')
  const contractDir = path.join(root, 'contracts')
  const appPath = path.join(root, 'app')
  const pid = 410
  const env = {
    SLIPWAY_APP_ID: '7',
    SLIPWAY_DEPLOYMENT_ID: '99',
    NODE_ENV: 'production',
    DATABASE_URL: 'production-secret'
  }
  const sailsApp = {
    config: {
      environment: 'production',
      datastores: {
        default: { adapter: 'sails-sqlite', url: './production.db' }
      },
      models: { datastore: 'default' }
    }
  }
  const statFields = Array(20).fill('0')
  statFields[0] = 'S'
  statFields[1] = '1'
  statFields[19] = '12345'
  const stat = `${pid} (custom entrypoint) ${statFields.join(' ')}`
  try {
    fs.mkdirSync(path.join(procRoot, String(pid)), { recursive: true })
    fs.mkdirSync(path.join(procRoot, 'self'))
    fs.mkdirSync(appPath)
    fs.writeFileSync(path.join(procRoot, 'self/stat'), stat)
    fs.writeFileSync(
      path.join(procRoot, 'self/environ'),
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\0') + '\0'
    )
    fs.writeFileSync(
      path.join(procRoot, 'self/cmdline'),
      `${process.execPath}\0/opt/custom-start.js\0--token=production-secret\0`
    )
    fs.writeFileSync(path.join(procRoot, String(pid), 'stat'), stat)
    fs.writeFileSync(
      path.join(procRoot, String(pid), 'cmdline'),
      `${process.execPath}\0/opt/custom-start.js\0--token=production-secret\0`
    )
    fs.writeFileSync(
      path.join(procRoot, String(pid), 'environ'),
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\0') + '\0'
    )
    fs.symlinkSync(appPath, path.join(procRoot, String(pid), 'cwd'))
    fs.symlinkSync(process.execPath, path.join(procRoot, String(pid), 'exe'))
    const fakeRuntime = {
      platform: 'linux',
      // Sails may change process.env after launch. /proc retains the startup
      // snapshot used by Helm's isolated execution process.
      env: { ...env, ADDED_AFTER_START: 'changed' },
      argv: [
        process.execPath,
        '/opt/custom-start.js',
        '--token=production-secret'
      ],
      execArgv: [],
      execPath: process.execPath,
      pid,
      cwd: () => appPath
    }
    const unregister = registerHelmRuntime({
      appId: '7',
      deploymentId: '99',
      sailsApp,
      runtime: fakeRuntime,
      directory: contractDir,
      procRoot
    })
    expect(typeof unregister).toBe('function')
    const contractPath = path.join(contractDir, `7-99-${pid}.json`)
    expect(fs.statSync(contractPath).mode & 0o777).toBe(0o600)
    expect(
      fs.readFileSync(contractPath, 'utf8').includes('production-secret')
    ).toBe(false)
    expect(
      registerHelmRuntime({
        appId: '7',
        deploymentId: '99',
        runtime: {
          ...fakeRuntime,
          argv: [process.execPath, '/app/node_modules/.bin/sails', 'run', 'job']
        },
        directory: contractDir,
        procRoot
      })
    ).toBe(null)
    const options = {
      procRoot,
      contractDir,
      ownPid: 999,
      expectedRuntime: { appId: '7', deploymentId: '99' }
    }
    const context = resolveContext(options)
    expect(context.appPath).toBe(appPath)
    expect(context.argv).toEqual(fakeRuntime.argv)
    expect(context.env.DATABASE_URL).toBe('production-secret')
    expect(context.datastoreFingerprint).toBe(
      fingerprintHelmDatastores(sailsApp)
    )
    expect(context.completionMetadata.version).toBe(1)

    let wrongDeployment
    try {
      resolveContext({
        ...options,
        expectedRuntime: { appId: '7', deploymentId: '100' }
      })
    } catch (caught) {
      wrongDeployment = caught
    }
    expect(wrongDeployment.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')

    fs.appendFileSync(
      path.join(procRoot, String(pid), 'environ'),
      'EXTRA=changed\0'
    )
    let changedEnvironment
    try {
      resolveContext(options)
    } catch (caught) {
      changedEnvironment = caught
    }
    expect(changedEnvironment.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
    fs.writeFileSync(
      path.join(procRoot, String(pid), 'environ'),
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\0') + '\0'
    )

    fs.writeFileSync(
      path.join(procRoot, String(pid), 'stat'),
      stat.replace('12345', '12346')
    )
    let error
    try {
      resolveContext(options)
    } catch (caught) {
      error = caught
    }
    expect(error.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
    expect(error.message.includes('production-secret')).toBe(false)
    unregister()
    let missingContract
    try {
      resolveContext({
        ...options,
        expectedRuntime: { ...options.expectedRuntime, required: true }
      })
    } catch (caught) {
      missingContract = caught
    }
    expect(missingContract.message).toContain(
      'not published its Helm runtime contract'
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Helm resolves the app process environment and rejects ambiguous or missing runtimes', async ({
  expect
}) => {
  const files = {
    '/proc/10/cmdline': 'node\0/app/app.js\0--environment=staging\0',
    '/proc/10/environ': 'NODE_ENV=staging\0TOKEN=a=b\0',
    '/proc/10/stat': '10 (node) S 1 0 0 0',
    '/app/package.json': JSON.stringify({ dependencies: { sails: '*' } }),
    '/proc/11/cmdline': 'node\0-e\0worker()\0',
    '/proc/11/stat': '11 (node) S 10 0 0 0',
    '/proc/12/cmdline':
      'node\0/usr/local/lib/node_modules/npm/bin/npm-cli.js\0start\0',
    '/proc/12/stat': '12 (node) S 1 0 0 0'
  }
  const fakeFs = {
    readdirSync: () => ['10', '11', '12', 'self'],
    readFileSync: (name) => {
      if (files[name] === undefined)
        throw Object.assign(new Error('Missing'), { code: 'ENOENT' })
      return files[name]
    },
    readlinkSync: () => '/app'
  }
  const context = resolveContext({ fs: fakeFs, ownPid: 99 })
  expect(context.appPath).toBe('/app')
  expect(context.env).toEqual({ NODE_ENV: 'staging', TOKEN: 'a=b' })
  expect(context.argv).toEqual(['node', '/app/app.js', '--environment=staging'])
  files['/proc/11/cmdline'] = 'node\0/app/other.js\0'
  files['/proc/11/environ'] = 'NODE_ENV=production\0'
  files['/proc/11/stat'] = '11 (node) S 1 0 0 0'
  let error
  try {
    resolveContext({ fs: fakeFs, ownPid: 99 })
  } catch (caught) {
    error = caught
  }
  expect(error.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
  expect(error.message.includes('TOKEN')).toBe(false)
  files['/proc/11/cmdline'] = files['/proc/10/cmdline']
  files['/proc/11/environ'] = files['/proc/10/environ']
  error = null
  try {
    resolveContext({ fs: fakeFs, ownPid: 99 })
  } catch (caught) {
    error = caught
  }
  expect(error.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
  delete files['/proc/10/cmdline']
  delete files['/proc/11/cmdline']
  error = null
  try {
    resolveContext({ fs: fakeFs, ownPid: 99 })
  } catch (caught) {
    error = caught
  }
  expect(error.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
})

test('Helm uses the server runtime when Quest runs a child Sails script', ({
  expect
}) => {
  const files = {
    '/proc/10/cmdline': 'node\0/app/app.js\0',
    '/proc/10/environ': 'NODE_ENV=production\0DATABASE_URL=production-secret\0',
    '/proc/10/stat': '10 (app server) S 1 0 0 0',
    '/proc/20/cmdline':
      'node\0/app/node_modules/.bin/sails\0run\0reconcile-withdrawals\0',
    '/proc/20/environ': 'NODE_ENV=production\0DATABASE_URL=script-override\0',
    '/proc/20/stat': '20 (quest worker) S 30 0 0 0',
    '/proc/30/stat': '30 (shell) S 10 0 0 0',
    '/app/package.json': JSON.stringify({ dependencies: { sails: '*' } })
  }
  const fakeFs = {
    readdirSync: () => ['10', '20', '30'],
    readFileSync: (name) => {
      if (files[name] === undefined)
        throw Object.assign(new Error('Missing'), { code: 'ENOENT' })
      return files[name]
    },
    readlinkSync: () => '/app'
  }

  const context = resolveContext({ fs: fakeFs, ownPid: 99 })
  expect(context.argv).toEqual(['node', '/app/app.js'])
  expect(context.env.DATABASE_URL).toBe('production-secret')

  delete files['/proc/10/cmdline']
  let missingAppError
  try {
    resolveContext({ fs: fakeFs, ownPid: 99 })
  } catch (caught) {
    missingAppError = caught
  }
  expect(missingAppError.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
  files['/proc/10/cmdline'] = 'node\0/app/app.js\0'

  files['/proc/20/cmdline'] = 'node\0/app/worker.js\0'
  delete files['/proc/20/stat']
  let error
  try {
    resolveContext({ fs: fakeFs, ownPid: 99 })
  } catch (caught) {
    error = caught
  }
  expect(error.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
  expect(error.message.includes('production-secret')).toBe(false)
})

test('Helm reads the deployed SQLite database with rc overrides and safe migrations', async ({
  expect
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-datastore-'))
  try {
    fs.mkdirSync(path.join(root, 'config/env'), { recursive: true })
    fs.mkdirSync(path.join(root, 'api/models'), { recursive: true })
    fs.symlinkSync(
      path.resolve('node_modules'),
      path.join(root, 'node_modules'),
      'dir'
    )
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: { sails: '*', 'sails-hook-orm': '*', 'sails-sqlite': '*' }
      })
    )
    fs.writeFileSync(
      path.join(root, '.sailsrc'),
      JSON.stringify({
        loadHooks: ['moduleloader', 'userconfig', 'userhooks', 'orm'],
        models: { migrate: 'drop', schema: true },
        custom: { retained: 'rc-value' }
      })
    )
    fs.writeFileSync(
      path.join(root, 'config/datastores.js'),
      "module.exports.datastores={default:{adapter:'sails-sqlite',url:'./dev.db'}}"
    )
    fs.writeFileSync(
      path.join(root, 'config/env/production.js'),
      "module.exports={datastores:{default:{url:'./production.db'}}}"
    )
    fs.writeFileSync(
      path.join(root, 'config/env/staging.js'),
      "module.exports={datastores:{default:{url:'./staging.db'}}}"
    )
    fs.writeFileSync(
      path.join(root, 'api/models/User.js'),
      "module.exports={tableName:'users',attributes:{id:{type:'number',autoIncrement:true},name:{type:'string'}}}"
    )
    const Database = require('better-sqlite3')
    for (const name of ['production', 'staging', 'override']) {
      const db = new Database(path.join(root, `${name}.db`))
      db.exec(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1, '${name}');`
      )
      db.close()
    }
    let productionFingerprint
    for (const [environment, extra, expected] of [
      ['production', {}, 'production'],
      ['staging', {}, 'staging'],
      [
        'production',
        { sails_datastores__default__url: './override.db' },
        'override'
      ]
    ]) {
      const prepared = runtime.prepareSource(
        '({users:await User.find(), environment:sails.config.environment, migrate:sails.config.models.migrate, retained:sails.config.custom.retained, configJson:JSON.stringify({environment:sails.config.environment,datastores:sails.config.datastores,models:{datastore:sails.config.models.datastore,connection:sails.config.models.connection}})})'
      )
      const script = runtime.buildRunnerSource({
        preparedSource: prepared.source,
        bootstrapSails: true,
        appContext: {
          appPath: root,
          env: {
            PATH: process.env.PATH,
            HOME: root,
            NODE_ENV: environment,
            ...extra
          },
          argv: [process.execPath, 'app.js']
        },
        timeoutMs: 10000
      })
      const result = spawnSync(process.execPath, [], {
        input: script,
        encoding: 'utf8',
        timeout: 15000
      })
      const envelope = runtime.parseRunnerOutput(result.stdout)
      require('node:assert/strict').equal(
        envelope.success,
        true,
        JSON.stringify(envelope.error)
      )
      expect(envelope.value.users[0].name).toBe(expected)
      expect(envelope.value.environment).toBe(environment)
      expect(envelope.value.migrate).toBe('safe')
      expect(envelope.value.retained).toBe('rc-value')
      if (expected === 'production') {
        productionFingerprint = fingerprintHelmDatastores({
          config: JSON.parse(envelope.value.configJson)
        })
      }
    }
    const prepared = runtime.prepareSource('await User.find()')
    const verifiedScript = runtime.buildRunnerSource({
      preparedSource: prepared.source,
      bootstrapSails: true,
      appContext: {
        appPath: root,
        env: { PATH: process.env.PATH, HOME: root, NODE_ENV: 'production' },
        argv: [process.execPath, 'app.js'],
        datastoreFingerprint: productionFingerprint
      },
      timeoutMs: 10000
    })
    const verifiedProcess = spawnSync(process.execPath, [], {
      input: verifiedScript,
      encoding: 'utf8',
      timeout: 15000
    })
    const verified = runtime.parseRunnerOutput(verifiedProcess.stdout)
    expect(verified.success).toBe(true)
    expect(verified.value[0].name).toBe('production')
    const mismatchScript = runtime.buildRunnerSource({
      preparedSource: prepared.source,
      bootstrapSails: true,
      appContext: {
        appPath: root,
        env: { PATH: process.env.PATH, HOME: root, NODE_ENV: 'production' },
        argv: [process.execPath, 'app.js'],
        datastoreFingerprint: '0'.repeat(64)
      },
      timeoutMs: 10000
    })
    const mismatchProcess = spawnSync(process.execPath, [], {
      input: mismatchScript,
      encoding: 'utf8',
      timeout: 15000
    })
    const mismatch = runtime.parseRunnerOutput(mismatchProcess.stdout)
    expect(mismatch.success).toBe(false)
    expect(mismatch.error.code).toBe('HELM_DATASTORE_MISMATCH')
    expect(fs.existsSync(path.join(root, 'dev.db'))).toBe(false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
