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
    stdout: { write: (text) => output.push(text) },
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
