const { test } = require('sounding')
const {
  nativeStatements,
  isWidening
} = require('../../../../api/lib/native-migration-contract')

function emptyDiff() {
  return {
    tablesToCreate: [],
    tablesToDrop: [],
    columnsToAdd: [],
    columnsToDrop: [],
    columnsToRename: [],
    columnsToModify: [],
    indexesToCreate: []
  }
}

test('MySQL widening retains default, collation, comments, and native column attributes verbatim', ({
  expect
}) => {
  const diff = emptyDiff()
  diff.columnsToModify.push({
    tableName: 'accounts',
    columnName: 'email',
    current: { type: 'varchar(32)', nullable: false },
    expected: { sqlType: 'varchar(64)', nullable: false }
  })
  const schema = {
    accounts: {
      sql: "CREATE TABLE `accounts` (`email` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'native' COMMENT 'keep, (this) and NOT NULL', `amount` decimal(8,2)) ENGINE=InnoDB"
    }
  }
  const statements = nativeStatements(diff, 'mysql', schema)
  expect(statements[0].sql).toBe(
    "ALTER TABLE `accounts` MODIFY COLUMN `email` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'native' COMMENT 'keep, (this) and NOT NULL';"
  )
})

test('ambiguous casts, injected type fragments, and unbackfilled constraints never produce executable SQL', ({
  expect
}) => {
  expect(isWidening('varchar(64)', 'varchar(32)', 'postgresql')).toBe(false)
  expect(isWidening('text', 'integer', 'postgresql')).toBe(false)
  expect(isWidening('integer', 'bigint', 'postgresql')).toBe(true)
  const cases = [
    {
      ...emptyDiff(),
      columnsToModify: [
        {
          tableName: 'accounts',
          columnName: 'email',
          current: { type: 'text', nullable: true },
          expected: { sqlType: 'integer', nullable: true }
        }
      ]
    },
    {
      ...emptyDiff(),
      columnsToAdd: [
        {
          tableName: 'accounts',
          columnName: 'token',
          sqlType: 'TEXT NOT NULL',
          nullable: true
        }
      ]
    },
    {
      ...emptyDiff(),
      columnsToAdd: [
        {
          tableName: 'accounts',
          columnName: 'token',
          sqlType: 'TEXT',
          nullable: false
        }
      ]
    }
  ]
  for (const diff of cases)
    expect(
      nativeStatements(diff, 'postgresql').every((item) => item.blocked)
    ).toBe(true)
})

test('new native tables include ordinary indexes and preserve identity widths and quoted identifiers', ({
  expect
}) => {
  const diff = emptyDiff()
  diff.tablesToCreate.push({
    tableName: 'order"details',
    columns: [
      {
        name: 'id',
        sqlType: 'BIGSERIAL',
        autoIncrement: true,
        primaryKey: true
      },
      { name: 'name', sqlType: 'TEXT', nullable: true }
    ]
  })
  const models = {
    order: {
      tableName: 'order"details',
      primaryKey: 'id',
      attributes: { id: {}, name: { index: true } }
    }
  }
  const statements = nativeStatements(diff, 'postgresql', {}, models)
  expect(statements.length).toBe(2)
  expect(statements[0].sql).toContain('CREATE TABLE "order""details"')
  expect(statements[0].sql).toContain('"id" BIGSERIAL')
  expect(statements[1].sql).toContain('CREATE INDEX')
  expect(statements[1].sql).toContain('ON "order""details" ("name")')
})

test('MySQL ORM timestamps produce executable table and index plans', async ({
  expect
}) => {
  const models = {
    note: {
      tableName: 'notes',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number', columnType: '_numberkey', autoIncrement: true },
        caption: { type: 'string', index: true },
        createdAt: {
          type: 'string',
          autoCreatedAt: true,
          columnType: '_stringtimestamp'
        }
      }
    }
  }
  const diff = await require('../../../../api/helpers/dock/generate-diff').fn({
    models,
    schema: {},
    dbType: 'mysql'
  })
  const statements = nativeStatements(diff, 'mysql', {}, models)
  expect(statements.length).toBe(2)
  expect(Boolean(statements[0].blocked)).toBe(false)
  expect(statements[0].sql).toContain('`createdAt` VARCHAR(255)')
  expect(statements[1].sql).toContain('CREATE INDEX')
})
