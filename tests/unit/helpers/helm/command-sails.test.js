const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const launchSailsCommand = require('../../../../api/lib/helm-command-sails')
const fingerprintDatastores = require('../../../../api/lib/contracts/helm-config-fingerprint')

const SCRIPT = `module.exports = {
  friendlyName: 'Native command probe',
  inputs: {
    handle: { type: 'string', required: true },
    count: { type: 'number', defaultsTo: 5 },
    dryRun: { type: 'boolean', defaultsTo: true },
    filter: { type: 'json' },
    empty: { type: 'string', allowEmpty: true },
    environment: { type: 'string' }
  },
  fn: async function (inputs) {
    console.log('SCRIPT:' + JSON.stringify({
      inputs,
      argv: process.argv.slice(2),
      environment: this.sails.config.environment,
      migrate: this.sails.config.models.migrate,
      autoStart: this.sails.config.quest.autoStart,
      custom: this.sails.config.custom,
      helmProbe: this.sails.config.helmProbe,
      users: await this.sails.models.user.find(),
      initialized: this.sails.nativeCommandInitialized,
      config: {
        environment: this.sails.config.environment,
        datastores: this.sails.config.datastores,
        models: {
          datastore: this.sails.config.models.datastore,
          connection: this.sails.config.models.connection
        }
      }
    }));
    return 'NATIVE_RESULT';
  }
}`

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-command-sails-'))
  for (const dir of ['scripts', 'config/env', 'api/models', 'api/hooks/probe'])
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: { forbidden: 'echo SHELL_ALIAS_RAN' },
      dependencies: {
        sails: '*',
        'sails-hook-orm': '*',
        'sails-sqlite': '*',
        'sails-hook-quest': '*'
      }
    })
  )
  fs.writeFileSync(
    path.join(root, '.sailsrc'),
    JSON.stringify({
      loadHooks: [
        'moduleloader',
        'userconfig',
        'userhooks',
        'orm',
        'quest',
        'probe'
      ],
      models: { migrate: 'drop', schema: true },
      quest: { autoStart: true },
      log: { level: 'silent' }
    })
  )
  fs.writeFileSync(
    path.join(root, 'config/datastores.js'),
    `module.exports.datastores = {default:{adapter:'sails-sqlite',url:'./wrong.db'}}`
  )
  fs.writeFileSync(
    path.join(root, 'config/env/staging.js'),
    `process.env.HELM_CONFIG_MARKER='reproduced'; module.exports={
      custom:{argvSeen:process.argv.slice(2)},
      bootstrap:function(done){console.log('UNEXPECTED_BOOTSTRAP');done()},
      beforeShutdown:function(done){console.log('NATIVE_LOWER');done()}
    }`
  )
  fs.writeFileSync(
    path.join(root, 'api/hooks/probe/index.js'),
    `module.exports = function(sails){return {
      initialize: function(done){sails.nativeCommandInitialized=true;done()}
    }}`
  )
  fs.writeFileSync(
    path.join(root, 'api/models/User.js'),
    `module.exports={tableName:'users',attributes:{id:{type:'number',autoIncrement:true},name:{type:'string'}}}`
  )
  fs.writeFileSync(path.join(root, 'scripts/probe.js'), SCRIPT)
  fs.writeFileSync(
    path.join(root, 'scripts/analog.js'),
    `module.exports={friendlyName:'Analog', args:['handle'], inputs:{handle:{type:'string',required:true}}, fn:function(inputs, exits){console.log('ANALOG:'+inputs.handle);return exits.success('ANALOG_RESULT')}}`
  )
  fs.writeFileSync(
    path.join(root, 'scripts/exception.js'),
    `module.exports={friendlyName:'Exception',exits:{skipped:{description:'Skipped'}},fn:async function(){throw {skipped:'CUSTOM_EXIT'}}}`
  )
  fs.writeFileSync(
    path.join(root, 'scripts/error.js'),
    `module.exports={friendlyName:'Failure',fn:async function(){throw new Error('SCRIPT_FAILURE')}}`
  )
  fs.writeFileSync(
    path.join(root, 'scripts/unmanaged.js'),
    `module.exports={friendlyName:'Unmanaged',sails:false,fn:async function(){console.log('UNMANAGED_RAN')}}`
  )
  fs.writeFileSync(
    path.join(root, 'scripts/nested.js'),
    `module.exports={def:{friendlyName:'Nested',fn:async function(){console.log('NESTED_RAN')}}}`
  )
  const Database = require('better-sqlite3')
  const db = new Database(path.join(root, 'selected.db'))
  db.exec(
    `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1, 'selected app database');`
  )
  db.close()
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    NODE_ENV: 'staging',
    SLIPWAY_HELM_EXECUTION_ID: 'native-command-test'
  }
  const runtimeArgs = [
    '--datastores.default.url=./selected.db',
    '--helmProbe.fromArgv=retained',
    '--drop'
  ]
  return {
    root,
    env,
    runtimeArgs,
    run(args = ['probe', '--handle=operator'], extraContext = {}) {
      const appContext = {
        argv: [process.execPath, path.join(root, 'app.js'), ...runtimeArgs],
        ...extraContext
      }
      return spawnSync(process.execPath, [], {
        cwd: root,
        env,
        input: `(${launchSailsCommand.toString()})(${JSON.stringify({
          argv: ['sails', 'run', ...args],
          appContext
        })})`,
        encoding: 'utf8',
        timeout: 15000
      })
    },
    close() {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

function success(result) {
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /NATIVE_LOWER/)
  assert.doesNotMatch(result.stdout, /UNEXPECTED_BOOTSTRAP/)
}

function scriptOutput(result) {
  const line = result.stdout
    .split('\n')
    .find((value) => value.startsWith('SCRIPT:'))
  assert.ok(line, result.stderr + result.stdout)
  return JSON.parse(line.slice('SCRIPT:'.length))
}

function environmentFingerprint(env) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        Object.keys(env)
          .filter((key) => key !== 'SLIPWAY_HELM_EXECUTION_ID')
          .sort()
          .map((key) => [key, String(env[key])])
      )
    )
    .digest('hex')
}

test('Helm uses native Sails CLI inputs and selected app rc with safe migrations and disabled Quest autostart', async () => {
  const app = fixture()
  try {
    const args = [
      'probe',
      '--handle=hello world',
      '--count=0',
      '--dryRun=false',
      '--filter={"published":true}',
      '--empty=',
      '--environment=other'
    ]
    const result = app.run(args)
    success(result)
    assert.match(result.stdout, /NATIVE_RESULT/)
    const output = scriptOutput(result)
    assert.deepEqual(output.inputs, {
      handle: 'hello world',
      count: 0,
      dryRun: false,
      filter: { published: true },
      empty: '',
      environment: 'other'
    })
    assert.deepEqual(output.argv, ['run', ...args])
    assert.equal(output.environment, 'staging')
    assert.equal(output.migrate, 'safe')
    assert.equal(output.autoStart, false)
    assert.equal(output.helmProbe.fromArgv, 'retained')
    assert.deepEqual(output.custom.argvSeen, app.runtimeArgs)
    assert.equal(output.initialized, true)
    assert.deepEqual(output.users, [{ id: 1, name: 'selected app database' }])
    assert.equal(fs.existsSync(path.join(app.root, 'wrong.db')), false)
  } finally {
    app.close()
  }
})

test('Helm retains native required-input and type validation and lowers on failures', async () => {
  const app = fixture()
  try {
    for (const args of [
      ['probe'],
      ['probe', '--handle=operator', '--count=invalid']
    ]) {
      const result = app.run(args)
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, /missing or invalid/)
      assert.match(result.stdout, /NATIVE_LOWER/)
      assert.doesNotMatch(result.stdout, /SCRIPT:/)
    }
    const result = app.run(['probe', '--unknown-option=true'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unknown option|unrecognized/i)
    assert.doesNotMatch(result.stdout, /SCRIPT:/)
  } finally {
    app.close()
  }
})

test('Helm preserves callback exits, custom exits, errors and native lowering', async () => {
  const app = fixture()
  try {
    const analog = app.run(['analog', '--handle=callback'])
    success(analog)
    assert.match(analog.stdout, /ANALOG:callback/)
    assert.match(analog.stdout, /ANALOG_RESULT/)
    const serial = app.run(['analog', 'positional'])
    success(serial)
    assert.match(serial.stdout, /ANALOG:positional/)
    const exception = app.run(['exception'])
    success(exception)
    assert.match(exception.stdout + exception.stderr, /CUSTOM_EXIT/)
    const failure = app.run(['error'])
    assert.equal(failure.status, 1)
    assert.match(failure.stdout, /NATIVE_LOWER/)
    assert.match(failure.stderr, /SCRIPT_FAILURE/)
  } finally {
    app.close()
  }
})

test('Helm verifies runtime environment and datastores before invoking the user script', async () => {
  const app = fixture()
  try {
    const baseline = app.run()
    success(baseline)
    const context = {
      environmentFingerprint: environmentFingerprint({
        ...app.env,
        HELM_CONFIG_MARKER: 'reproduced'
      }),
      datastoreFingerprint: fingerprintDatastores({
        config: scriptOutput(baseline).config
      })
    }
    success(app.run(undefined, context))
    for (const [field, code] of [
      ['environmentFingerprint', 'HELM_ENVIRONMENT_MISMATCH'],
      ['datastoreFingerprint', 'HELM_DATASTORE_MISMATCH']
    ]) {
      const result = app.run(undefined, { ...context, [field]: '0'.repeat(64) })
      assert.equal(result.status, 1)
      assert.match(result.stderr, new RegExp(code))
      assert.match(result.stdout, /NATIVE_LOWER/)
      assert.doesNotMatch(result.stdout, /SCRIPT:/)
      assert.doesNotMatch(result.stderr, /selected\.db|PATH=/)
    }
  } finally {
    app.close()
  }
})

test('Helm rejects lifecycle-free scripts and package shell aliases without executing them', async () => {
  const app = fixture()
  try {
    for (const name of [
      'unmanaged',
      'nested',
      'forbidden',
      'scripts/forbidden.js'
    ]) {
      const result = app.run([name])
      assert.equal(result.status, 1)
      assert.match(result.stderr, /HELM_COMMAND_UNSUPPORTED_SCRIPT/)
      assert.doesNotMatch(
        result.stdout,
        /UNMANAGED_RAN|NESTED_RAN|SHELL_ALIAS_RAN|NATIVE_LOWER/
      )
    }
    const missing = app.run(['missing'])
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /Unknown script/)
  } finally {
    app.close()
  }
})

test('Helm fails closed before launching an unverified Sails release', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-command-version-'))
  try {
    for (const name of ['sails', 'whelk'])
      fs.mkdirSync(path.join(root, 'node_modules', name), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    fs.writeFileSync(
      path.join(root, 'node_modules/sails/package.json'),
      JSON.stringify({ name: 'sails', version: '2.0.0' })
    )
    fs.writeFileSync(
      path.join(root, 'node_modules/whelk/package.json'),
      JSON.stringify({ name: 'whelk', version: '6.0.2' })
    )
    const result = spawnSync(process.execPath, [], {
      cwd: root,
      input: `(${launchSailsCommand.toString()})({argv:['sails','run','probe']})`,
      encoding: 'utf8',
      timeout: 5000
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /HELM_COMMAND_UNSUPPORTED_SAILS/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
