// Reproducible, disposable native catalog check. Requires Docker and a local
// postgres:16-alpine or mysql:8.4 image; never connects to an existing database.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const execute = require('../api/helpers/dock/execute-sql')
const getSchema = require('../api/helpers/dock/get-schema')
const generateDiff = require('../api/helpers/dock/generate-diff')
const generateSql = require('../api/helpers/dock/generate-migration-sql')
const preflight = require('../api/helpers/dock/preflight-native-migration')

async function main() {
  const type = process.env.SLIPWAY_SCHEMA_TEST_DIALECT || 'postgresql'
  assert.ok(['postgresql', 'mysql'].includes(type))
  const pg = type === 'postgresql'
  const containerName = `slipway-schema-test-${randomUUID()}`
  const service = {
    type,
    containerName,
    username: pg ? 'postgres' : 'root',
    password: pg ? '' : 'disposable-schema-fixture',
    database: pg ? 'postgres' : 'fixture'
  }
  global.sails = {
    config: {},
    log: { verbose() {}, error() {} },
    helpers: {
      dock: {
        executeSql: (service, query) =>
          execute.fn({ service, query, format: 'json' }).then((result) => {
            if (!result.success)
              console.error(
                'Disposable fixture query failed:',
                query,
                result.error
              )
            return result
          })
      }
    }
  }
  async function query(sql) {
    const result = await sails.helpers.dock.executeSql(service, sql)
    assert.equal(result.success, true, result.error)
    return result
  }
  async function snapshot() {
    const result = await getSchema.fn({ service })
    assert.equal(result.error, undefined, result.error)
    return result.tables
  }
  try {
    execFileSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        containerName,
        '--tmpfs',
        `${pg ? '/var/lib/postgresql/data' : '/var/lib/mysql'}:rw,size=512m`,
        ...(pg
          ? ['-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']
          : [
              '-e',
              'MYSQL_ROOT_PASSWORD=disposable-schema-fixture',
              '-e',
              'MYSQL_DATABASE=fixture',
              'mysql:8.4'
            ])
      ],
      { stdio: 'pipe' }
    )
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await sails.helpers.dock.executeSql(service, 'SELECT 1')
      if (result.success) {
        ready = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    assert.ok(ready, 'Fixture database did not become ready')
    await query(
      `CREATE TABLE accounts (id ${
        pg ? 'SERIAL' : 'INTEGER AUTO_INCREMENT'
      } PRIMARY KEY, email VARCHAR(32) NOT NULL DEFAULT '', balance NUMERIC(8,2)); CREATE INDEX idx_accounts_email ON accounts(email); CREATE INDEX accounts_composite ON accounts(balance DESC, email); INSERT INTO accounts(email, balance) VALUES ('one@example.test', 12.34);`
    )
    if (!pg)
      await query(
        "ALTER TABLE accounts MODIFY COLUMN email varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '' COMMENT 'native, (preserved)'; ALTER TABLE accounts ADD COLUMN email_length INTEGER GENERATED ALWAYS AS (CHAR_LENGTH(email)) STORED;"
      )
    if (pg)
      await query(
        'CREATE INDEX accounts_expression ON accounts(lower(email)); CREATE INDEX accounts_partial ON accounts(email) WHERE balance > 0;'
      )
    const models = {
      account: {
        tableName: 'accounts',
        primaryKey: 'id',
        attributes: {
          id: { type: 'number', autoIncrement: true },
          email: {
            type: 'string',
            columnType: 'varchar(32)',
            unique: true,
            required: false,
            defaultsTo: 'application-only'
          },
          balance: { type: 'number', columnType: 'numeric(8,2)' }
        }
      }
    }
    const before = await snapshot()
    assert.equal(before.accounts.columns[0].primaryKey, true)
    assert.equal(before.accounts.columns[0].autoIncrement, true)
    assert.deepEqual(
      before.accounts.indexes.find(
        (index) => index.name === 'accounts_composite'
      ).columns,
      ['balance', 'email']
    )
    if (pg) {
      assert.equal(
        before.accounts.indexes.find(
          (index) => index.name === 'accounts_expression'
        ).columns[0],
        null
      )
      assert.ok(
        before.accounts.indexes.find(
          (index) => index.name === 'accounts_partial'
        ).predicate
      )
    } else assert.ok(before.accounts.sql.includes('CREATE TABLE'))
    const diff = await generateDiff.fn({ models, schema: before, dbType: type })
    assert.equal(
      diff.state,
      'changes_pending',
      JSON.stringify(diff.unsupported)
    )
    assert.equal(diff.indexesToCreate.length, 1)
    assert.equal(diff.columnsToModify.length, 0)
    const migration = await generateSql.fn({
      models,
      schema: before,
      diff,
      dbType: type
    })
    await query(
      "INSERT INTO accounts(email, balance) VALUES ('one@example.test', 12.34)"
    )
    const duplicates = await preflight.fn({
      service,
      schema: before,
      statements: migration.statements
    })
    assert.equal(duplicates.verified, false)
    assert.ok(duplicates.reason.includes('duplicate values'))
    await query('DELETE FROM accounts WHERE id = 2')
    for (const statement of migration.statements) await query(statement.sql)
    const after = await snapshot()
    const clean = await generateDiff.fn({ models, schema: after, dbType: type })
    assert.equal(clean.state, 'up_to_date')
    assert.deepEqual(
      await generateDiff.fn({ models, schema: after, dbType: type }),
      clean
    )
    assert.equal(
      after.accounts.columns[1].defaultValue,
      before.accounts.columns[1].defaultValue
    )
    models.account.attributes.email.columnType = 'varchar(64)'
    models.account.attributes.balance.columnType = 'numeric(10,3)'
    const changed = await generateDiff.fn({
      models,
      schema: after,
      dbType: type
    })
    assert.equal(changed.columnsToModify.length, 2)
    if (pg) {
      await query('CREATE VIEW account_names AS SELECT email FROM accounts')
      const protectedDiff = await generateDiff.fn({
        models,
        schema: await snapshot(),
        dbType: type
      })
      assert.equal(protectedDiff.state, 'unverified')
      const blocked = await generateSql.fn({
        models,
        schema: await snapshot(),
        diff: protectedDiff,
        dbType: type
      })
      assert.ok(blocked.statements.every((statement) => statement.blocked))
      await query('DROP VIEW account_names')
    }
    const executable = await generateSql.fn({
      models,
      schema: after,
      diff: changed,
      dbType: type
    })
    assert.ok(
      executable.statements.every((statement) => !statement.blocked),
      JSON.stringify(executable)
    )
    const checked = await preflight.fn({
      service,
      statements: executable.statements,
      schema: after
    })
    assert.equal(checked.verified, true, checked.reason)
    assert.equal(checked.affectedRows.accounts, 1)
    assert.equal(
      (await snapshot()).accounts.columns[1].type,
      after.accounts.columns[1].type
    )
    for (const statement of executable.statements) await query(statement.sql)
    const finalSchema = await snapshot()
    assert.equal(
      (await generateDiff.fn({ models, schema: finalSchema, dbType: type }))
        .state,
      'up_to_date'
    )
    assert.equal(
      finalSchema.accounts.columns[1].defaultValue,
      before.accounts.columns[1].defaultValue
    )
    assert.equal(
      finalSchema.accounts.columns[1].comment,
      before.accounts.columns[1].comment
    )
    assert.equal(
      finalSchema.accounts.columns[1].collation,
      before.accounts.columns[1].collation
    )
    if (!pg)
      assert.equal(
        finalSchema.accounts.columns.find(
          (column) => column.name === 'email_length'
        ).generated,
        before.accounts.columns.find((column) => column.name === 'email_length')
          .generated
      )
    assert.equal(
      finalSchema.accounts.columns[1].nullable,
      before.accounts.columns[1].nullable
    )
    const data = await query('SELECT email, balance FROM accounts')
    assert.equal(data.rows[0].email, 'one@example.test')
    assert.equal(Number(data.rows[0].balance), 12.34)
    const invalid = await preflight.fn({
      service,
      schema: finalSchema,
      statements: [
        {
          type: 'add_column',
          table: 'accounts',
          sql: 'ALTER TABLE accounts ADD COLUMN ephemeral_column INTEGER;'
        },
        {
          type: 'modify_column',
          table: 'accounts',
          sql: 'ALTER TABLE accounts ALTER COLUMN missing_column TYPE INTEGER;'
        }
      ]
    })
    assert.equal(invalid.verified, false)
    assert.ok(invalid.statements.every((statement) => statement.blocked))
    assert.equal(
      (await snapshot()).accounts.columns.some(
        (column) => column.name === 'ephemeral_column'
      ),
      false
    )
    models.note = {
      tableName: 'notes',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'number',
          columnType: pg ? 'BIGSERIAL' : 'BIGINT',
          autoIncrement: true
        },
        caption: { type: 'string', index: true },
        createdAt: {
          type: 'string',
          autoCreatedAt: true,
          columnType: '_stringtimestamp'
        }
      }
    }
    const createDiff = await generateDiff.fn({
      models,
      schema: finalSchema,
      dbType: type
    })
    const createPlan = await generateSql.fn({
      models,
      schema: finalSchema,
      diff: createDiff,
      dbType: type
    })
    assert.equal(createPlan.statements.length, 2)
    const createCheck = await preflight.fn({
      service,
      schema: finalSchema,
      statements: createPlan.statements
    })
    assert.equal(createCheck.verified, true, createCheck.reason)
    for (const statement of createPlan.statements) await query(statement.sql)
    assert.equal(
      (
        await generateDiff.fn({
          models,
          schema: await snapshot(),
          dbType: type
        })
      ).state,
      'up_to_date'
    )
    console.log(
      `${type}: catalog definitions, index semantics, stable round trip, and protected changes verified.`
    )
  } finally {
    execFileSync('docker', ['rm', '-f', '-v', containerName], { stdio: 'pipe' })
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
