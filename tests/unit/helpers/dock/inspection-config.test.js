const { test } = require('sounding')
const vm = require('node:vm')
const { buildIntrospectionCode } =
  require('../../../../api/helpers/dock/get-models')._private

test('Dock inspection honors app rc settings while suppressing build hooks and auto-migrations', async ({
  expect
}) => {
  let options
  const models = {
    person: {
      tableName: 'people',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number' },
        owner: { model: 'user' },
        children: { collection: 'child' }
      },
      schema: {
        id: {
          type: 'number',
          autoMigrations: {
            columnType: '_numberkey',
            autoIncrement: true,
            unique: true
          }
        },
        owner: {
          type: 'string',
          foreignKey: true,
          columnName: 'owner_id',
          autoMigrations: { columnType: '_stringkey' }
        }
      }
    }
  }
  const app = {
    models,
    load: (config, done) => {
      options = config
      done()
    },
    lower: (done) => done()
  }
  const migrations = {
    autoMigrations: () => {
      throw new Error('Must not migrate')
    }
  }
  const output = []
  const processStub = {
    env: {},
    stdout: {
      write: (text, done) => {
        output.push(text)
        done()
      }
    },
    stderr: {
      write: (text) => {
        throw new Error(text)
      }
    },
    exit: () => {}
  }
  const required = (name) => {
    if (name === 'sails') return app
    if (name === 'node:path') return require('node:path')
    if (name === 'sails/accessible/rc')
      return (namespace) => {
        expect(namespace).toBe('sails')
        expect(processStub.env.REDIS_URL).toBe('redis://configured-cache:6379')
        return {
          datastores: { cache: { url: processStub.env.REDIS_URL } },
          models: { migrate: 'alter', schema: true },
          loadHooks: ['shipwright', 'content']
        }
      }
    return migrations
  }
  required.resolve = () => '/fixture/node_modules/orm/index.js'
  await vm.runInNewContext(
    buildIntrospectionCode(['REDIS_URL=redis://configured-cache:6379']),
    { require: required, process: processStub, sails: app }
  )
  expect(options.datastores.cache.url).toBe('redis://configured-cache:6379')
  expect(Array.from(options.loadHooks)).toEqual([
    'moduleloader',
    'userconfig',
    'userhooks',
    'orm'
  ])
  expect(options.models.migrate).toBe('safe')
  expect(options.models.schema).toBe(true)
  let completed = false
  migrations.autoMigrations('alter', {}, () => {
    completed = true
  })
  expect(completed).toBe(true)
  const person = JSON.parse(output.join('')).person
  expect(person.tableName).toBe('people')
  expect(person.attributes.id.autoIncrement).toBe(true)
  expect(person.attributes.id.unique).toBe(true)
  expect(person.attributes.owner.columnName).toBe('owner_id')
  expect(person.attributes.owner.foreignKey).toBe(true)
  expect(person.attributes.owner.columnType).toBe('_stringkey')
  expect(person.attributes.children).toBe(undefined)
})

for (const exposeSails of [true, false]) {
  test(`Dock inspection flushes large snapshots with sails globals ${
    exposeSails ? 'enabled' : 'disabled'
  }`, async () => {
    const assert = require('node:assert/strict')
    const { spawnSync } = require('node:child_process')
    const childSource = `
    const models = {};
    for (let index = 0; index < 400; index++) {
      const attributes = {};
      for (let column = 0; column < 20; column++)
        attributes['column_' + column] = { type: 'string' };
      models['table_' + index] = {
        identity: 'table_' + index, tableName: 'table_' + index,
        primaryKey: 'id', attributes
      };
    }
    const app = { models, load: (_options, done) => done(), lower: (done) => done() };
    const mockRequire = (name) => {
      if (name === 'node:path') return require('node:path');
      if (name === 'sails') return app;
      if (name === 'sails/accessible/rc') return () => ({ globals: false });
      return { autoMigrations() {} };
    };
    mockRequire.resolve = () => '/fixture/node_modules/orm/index.js';
    ${exposeSails ? 'global.sails = app;' : ''}
    new Function('require', ${JSON.stringify(
      buildIntrospectionCode()
    )})(mockRequire);
  `
    const child = spawnSync(process.execPath, [], {
      input: childSource,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024
    })
    assert.equal(child.status, 0, child.stderr)
    assert.ok(Buffer.byteLength(child.stdout) > 1024 * 1024)
    const models = JSON.parse(child.stdout)
    assert.equal(Object.keys(models).length, 400)
    for (let index = 0; index < 400; index++) {
      assert.equal(models['table_' + index].tableName, 'table_' + index)
      assert.equal(Object.keys(models['table_' + index].attributes).length, 20)
      assert.equal(models['table_' + index].attributes.column_19.type, 'string')
    }
  })
}

test('Dock inspection preserves UTF-8 characters split across process output chunks', async ({
  sails
}) => {
  const assert = require('node:assert/strict')
  const { executeInContainer } =
    require('../../../../api/helpers/dock/get-models')._private
  const originalDocker = sails.config.docker
  sails.config.docker = { ...originalDocker, binaryPath: process.execPath }
  const expected = { café: { tableName: 'café', defaultsTo: '日本語' } }
  const code = `
    const output = Buffer.from(${JSON.stringify(JSON.stringify(expected))});
    const error = Buffer.from('café');
    const split = output.indexOf(0xc3) + 1;
    process.stdout.write(output.subarray(0, split));
    process.stderr.write(error.subarray(0, 4));
    setTimeout(() => {
      process.stdout.end(output.subarray(split));
      process.stderr.end(error.subarray(4));
    }, 100);
  `
  try {
    const result = await executeInContainer(['-e', code], '')
    assert.equal(result.success, true)
    assert.deepEqual(JSON.parse(result.output), expected)
    assert.equal(result.error, 'café')
  } finally {
    sails.config.docker = originalDocker
  }
})
