const assert = require('node:assert/strict')
const { test } = require('sounding')
const getSchema = require('../../../../api/helpers/dock/get-schema')
const { splitSqlStatements } = require('../../../../api/lib/dock-sql-results')
const {
  schemaCatalogFixture
} = require('../../../support/schema-catalog-fixture')

for (const type of ['postgresql', 'mysql']) {
  test(`${type} inventories all native definitions with bounded client round trips`, async ({
    sails
  }) => {
    const fixture = schemaCatalogFixture({ type, tableCount: 41 })
    const original = sails.helpers.dock.executeSql
    sails.helpers.dock.executeSql = fixture.executeSql
    try {
      const result = await getSchema.fn({ service: { type } })
      assert.equal(result.error, undefined)
      assert.equal(Object.keys(result.tables).length, 41)
      assert.equal(fixture.calls.length, type === 'postgresql' ? 3 : 5)
      for (const query of fixture.calls)
        assert.ok(splitSqlStatements(query, type).length <= 20)
      for (const [name, table] of Object.entries(result.tables)) {
        assert.equal(table.catalogComplete, true)
        assert.equal(table.columns.length, 20)
        assert.equal(table.indexes.length, 1)
        assert.deepEqual(
          table.triggers,
          fixture.triggers.filter((row) => row.table_name === name)
        )
        assert.deepEqual(table.views, fixture.views)
        if (type === 'postgresql')
          assert.deepEqual(
            table.constraints,
            fixture.constraints.filter((row) => row.table_name === name)
          )
        else assert.equal(table.sql, `CREATE TABLE \`${name}\` (column_0 TEXT)`)
      }
    } finally {
      sails.helpers.dock.executeSql = original
    }
  })
}

test('native catalog batches fail closed on partial, failed, reordered, or malformed results', async ({
  sails
}) => {
  const original = sails.helpers.dock.executeSql
  const corruptions = [
    (result) => {
      result.success = false
    },
    (result) => {
      result.results.pop()
    },
    (result) => {
      result.results[0].status = 'error'
    },
    (result) => {
      result.results[0].rows = null
    },
    (result) => {
      result.results.reverse()
    },
    (result) => {
      delete result.results
    }
  ]
  try {
    for (const type of ['postgresql', 'mysql']) {
      for (const corrupt of corruptions) {
        const fixture = schemaCatalogFixture({ type })
        sails.helpers.dock.executeSql = async (service, query) => {
          const result = await fixture.executeSql(service, query)
          if (fixture.calls.length === 3) corrupt(result)
          return result
        }
        const result = await getSchema.fn({ service: { type } })
        assert.deepEqual(result.tables, {})
        assert.match(result.error, /native database definitions/)
      }
    }
  } finally {
    sails.helpers.dock.executeSql = original
  }
})

test('MySQL rejects a later incomplete batch without returning a partial verified catalog', async ({
  sails
}) => {
  const fixture = schemaCatalogFixture({ type: 'mysql', tableCount: 41 })
  const original = sails.helpers.dock.executeSql
  sails.helpers.dock.executeSql = async (service, query) => {
    const result = await fixture.executeSql(service, query)
    if (fixture.calls.length === 4) result.results[0].rows = []
    return result
  }
  try {
    const result = await getSchema.fn({ service: { type: 'mysql' } })
    assert.deepEqual(result.tables, {})
    assert.match(result.error, /native database definitions/)
  } finally {
    sails.helpers.dock.executeSql = original
  }
})

test('catalog queries remain sequential for a single migration transaction session', async ({
  sails
}) => {
  const fixture = schemaCatalogFixture({ type: 'postgresql' })
  const executeSql = require('../../../../api/helpers/dock/execute-sql')
  const original = sails.helpers.dock.executeSql
  let active = false
  const service = {
    type: 'postgresql',
    transaction: {
      async query(query) {
        assert.equal(active, false)
        active = true
        try {
          return await fixture.executeSql(service, query, 1)
        } finally {
          active = false
        }
      }
    }
  }
  sails.helpers.dock.executeSql = (service, query) =>
    executeSql.fn({ service, query })
  try {
    const result = await getSchema.fn({ service })
    assert.equal(result.error, undefined)
    assert.equal(fixture.calls.length, 3)
  } finally {
    sails.helpers.dock.executeSql = original
  }
})

test('MySQL batched table definitions keep quoted identifiers within one statement', async ({
  sails
}) => {
  const tableNames = ['plain', 'semi;colon', 'embedded`tick', 'line\nbreak']
  const fixture = schemaCatalogFixture({ type: 'mysql', tableNames })
  const original = sails.helpers.dock.executeSql
  sails.helpers.dock.executeSql = fixture.executeSql
  try {
    const result = await getSchema.fn({ service: { type: 'mysql' } })
    assert.equal(result.error, undefined)
    assert.deepEqual(Object.keys(result.tables), tableNames)
    const statements = splitSqlStatements(fixture.calls[2], 'mysql')
    assert.equal(statements.length, 2 + tableNames.length)
    for (const name of tableNames)
      assert.equal(
        result.tables[name].sql,
        `CREATE TABLE \`${name.replace(/`/g, '``')}\` (column_0 TEXT)`
      )
  } finally {
    sails.helpers.dock.executeSql = original
  }
})
