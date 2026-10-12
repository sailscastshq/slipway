const { test } = require('sounding')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { buildIntrospectionCode } =
  require('../../../../api/helpers/dock/get-models')._private
async function inspect(models, adapter, resolved = false) {
  const datastores = { content: { adapter } }
  const app = {
    models,
    ...(resolved
      ? { datastores: { content: { config: datastores.content } } }
      : { config: { datastores } }),
    load: (_config, done) => done(),
    lower: (done) => done()
  }
  let output = ''
  const requireStub = (name) => {
    if (name === 'sails') return app
    if (name === 'node:path') return require('node:path')
    if (name === 'sails/accessible/rc') return () => ({})
    return { autoMigrations() {} }
  }
  requireStub.resolve = () => '/fixture/node_modules/orm/index.js'
  await vm.runInNewContext(buildIntrospectionCode(), {
    require: requireStub,
    process: {
      env: {},
      stdout: {
        write(text, done) {
          output += text
          done()
        }
      },
      stderr: {
        write(text) {
          throw new Error(text)
        }
      },
      exit() {}
    }
  })
  return JSON.parse(output)
}
function contentModel() {
  return {
    identity: 'article',
    tableName: 'article',
    datastore: 'content',
    primaryKey: 'id',
    attributes: { id: { type: 'number', autoIncrement: true } }
  }
}
function nativeCatalog() {
  return {
    article: {
      catalogComplete: true,
      columns: [
        {
          name: 'id',
          type: 'character varying',
          primaryKey: true,
          autoIncrement: false,
          nullable: false
        }
      ],
      indexes: []
    }
  }
}
test('runtime content models cannot block five unrelated SQL table additions or change an unmanaged primary key', async ({
  sails
}) => {
  const raw = { article: contentModel() }
  for (let n = 1; n <= 5; n++)
    raw['receipt_' + n] = {
      identity: 'receipt_' + n,
      tableName: 'receipt_' + n,
      datastore: 'default',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        identity: { type: 'string', unique: true },
        createdAt: {
          type: 'number',
          autoCreatedAt: true,
          columnName: 'created_at'
        },
        attemptCount: {
          type: 'number',
          columnType: 'integer',
          columnName: 'attempt_count'
        }
      }
    }
  const schema = nativeCatalog()
  const before = await sails.helpers.dock.generateDiff(
    raw,
    schema,
    'postgresql'
  )
  assert.equal(before.state, 'unverified')
  assert.match(before.unsupported[0].reason, /primary keys or identity/)
  for (const resolved of [false, true]) {
    const models = await inspect(raw, 'sails-content', resolved)
    assert.equal(models.article, undefined)
    assert.equal(Object.keys(models).length, 5)
    const diff = await sails.helpers.dock.generateDiff(
      models,
      schema,
      'postgresql'
    )
    assert.equal(diff.state, 'changes_pending')
    assert.equal(diff.tablesToCreate.length, 5)
    assert.deepEqual(diff.columnsToModify, [])
    assert.deepEqual(diff.tablesToDrop, [])
    assert.ok(
      diff.preserved.some(
        (item) =>
          item.tableName === 'article' && item.kind === 'unmanaged table'
      )
    )
    for (const table of diff.tablesToCreate) {
      assert.equal(
        table.columns.find(
          (c) => c.name === 'created_at' || c.columnName === 'created_at'
        ).sqlType,
        'BIGINT'
      )
      assert.equal(
        table.columns.find(
          (c) => c.name === 'attempt_count' || c.columnName === 'attempt_count'
        ).sqlType,
        'integer'
      )
    }
    const { statements } = await sails.helpers.dock.generateMigrationSql(
      diff,
      'postgresql',
      models,
      schema
    )
    assert.ok(statements.length >= 5)
    assert.ok(statements.every((s) => !s.blocked))
    assert.doesNotMatch(
      statements.map((s) => s.sql).join('\n'),
      /(?:ALTER|DROP) TABLE "article"/
    )
    assert.match(statements.map((s) => s.sql).join('\n'), /UNIQUE/)
    assert.deepEqual(await inspect(raw, 'sails-content', resolved), models)
  }
})
test('datastore names and unknown adapters do not exempt real SQL identity changes', async ({
  sails
}) => {
  for (const adapter of ['sails-postgresql', 'sails-mysql', 'custom-adapter']) {
    const models = await inspect({ article: contentModel() }, adapter)
    assert.ok(models.article)
    const diff = await sails.helpers.dock.generateDiff(
      models,
      nativeCatalog(),
      'postgresql'
    )
    assert.equal(diff.state, 'unverified')
    const { statements } = await sails.helpers.dock.generateMigrationSql(
      diff,
      'postgresql',
      models,
      nativeCatalog()
    )
    assert.ok(statements.every((s) => s.blocked))
  }
})
