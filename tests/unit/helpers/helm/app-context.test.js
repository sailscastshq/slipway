const { test } = require('sounding')
const resolveContext = require('../../../../api/lib/helm-app-context')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const runtime = require('../../../../api/lib/helm-runtime')

test('Helm resolves the app process environment and rejects ambiguous or missing runtimes', async ({
  expect
}) => {
  const files = {
    '/proc/10/cmdline': 'node\0/app/app.js\0--environment=staging\0',
    '/proc/10/environ': 'NODE_ENV=staging\0TOKEN=a=b\0',
    '/app/package.json': JSON.stringify({ dependencies: { sails: '*' } }),
    '/proc/11/cmdline': 'node\0-e\0worker()\0',
    '/proc/12/cmdline':
      'node\0/usr/local/lib/node_modules/npm/bin/npm-cli.js\0start\0'
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
  let error
  try {
    resolveContext({ fs: fakeFs, ownPid: 99 })
  } catch (caught) {
    error = caught
  }
  expect(error.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
  expect(error.message.includes('TOKEN')).toBe(false)
  delete files['/proc/10/cmdline']
  delete files['/proc/11/cmdline']
  try {
    resolveContext({ fs: fakeFs, ownPid: 99 })
  } catch (caught) {
    error = caught
  }
  expect(error.code).toBe('HELM_APP_CONTEXT_UNAVAILABLE')
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
        '({users:await User.find(), environment:sails.config.environment, migrate:sails.config.models.migrate, retained:sails.config.custom.retained})'
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
    }
    expect(fs.existsSync(path.join(root, 'dev.db'))).toBe(false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
