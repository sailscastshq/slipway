const { test } = require('sounding')
const vm = require('node:vm')
const normalize = require('../../../../api/lib/canonical-model-snapshot')
const { buildIntrospectionCode } =
  require('../../../../api/helpers/dock/get-models')._private

function fixture() {
  return {
    Account: {
      identity: 'account',
      primaryKey: 'key',
      tableName: 'accounts',
      attributes: {
        key: { type: 'string' },
        members: { collection: 'member' }
      },
      schema: {
        key: {
          columnName: 'account_key',
          autoMigrations: {
            columnType: 'varchar(80)',
            unique: true,
            autoIncrement: false
          }
        }
      }
    },
    member: {
      identity: 'member',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number' },
        email: { type: 'string', unique: false },
        account: { model: 'Account' },
        manager: { model: 'member' },
        createdAt: false
      },
      schema: {
        id: {
          columnName: 'member_id',
          autoMigrations: {
            columnType: '_numberkey',
            autoIncrement: true,
            unique: true
          }
        },
        email: {
          columnName: 'email_address',
          autoMigrations: { columnType: '_string', unique: true }
        },
        account: {
          columnName: 'account_id',
          autoMigrations: { columnType: 'varchar(80)' }
        },
        manager: {
          columnName: 'manager_id',
          autoMigrations: { columnType: '_numberkey' }
        }
      }
    },
    metric: {
      identity: 'metric',
      datastore: 'observability',
      attributes: { id: { type: 'number' } }
    }
  }
}

test('canonical schema preserves normalized uniqueness, identity, mappings, and referenced key types', async ({
  expect
}) => {
  const models = normalize(fixture(), 'default')
  expect(Object.keys(models)).toEqual(['account', 'member'])
  expect(models.member.attributes.email.unique).toBe(true)
  expect(models.member.attributes.email.columnName).toBe('email_address')
  expect(models.member.attributes.id.autoIncrement).toBe(true)
  expect(models.member.attributes.id.primaryKey).toBe(true)
  expect(models.member.attributes.account.type).toBe('string')
  expect(models.member.attributes.account.columnType).toBe('varchar(80)')
  expect(models.member.attributes.account.autoIncrement).toBe(false)
  expect(models.member.attributes.manager.type).toBe('number')
  expect(models.member.attributes.manager.autoIncrement).toBe(false)
  expect(models.member.attributes.createdAt).toBe(undefined)
  expect(models.account.attributes.members).toBe(undefined)
})

test('Bosun and serialized container discovery use the identical canonical normalizer', async ({
  sails,
  expect
}) => {
  const originalModels = sails.models
  const originalService = sails.helpers.bosun.getDatabaseService
  const models = fixture()
  const emitted = []
  try {
    sails.models = models
    sails.helpers.bosun.getDatabaseService = async () => ({
      datastore: 'default'
    })
    const local = await sails.helpers.bosun.getModels('app')
    const required = (name) =>
      name === 'sails'
        ? { models, load: (_options, done) => done(), lower: (done) => done() }
        : name === 'node:path'
        ? require('node:path')
        : {
            autoMigrations: () => {
              throw new Error('Must not migrate')
            }
          }
    required.resolve = (name) => require.resolve(name)
    const processStub = {
      env: {},
      stdout: {
        write: (text, done) => {
          emitted.push(text)
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
    await vm.runInNewContext(buildIntrospectionCode('default'), {
      require: required,
      sails: { models },
      process: processStub
    })
    expect(JSON.parse(emitted.join(''))).toEqual(local.models)
  } finally {
    sails.models = originalModels
    sails.helpers.bosun.getDatabaseService = originalService
  }
})

test('current runtime unique fields survive schema discovery', async ({
  sails,
  expect
}) => {
  const models = normalize(sails.models, 'default')
  for (const [model, attribute] of [
    ['user', 'email'],
    ['project', 'slug'],
    ['setting', 'key'],
    ['bridgelaunchcode', 'tokenHash']
  ]) {
    expect(models[model].attributes[attribute].unique).toBe(true)
  }
})
