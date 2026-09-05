const Database = require('better-sqlite3')
const { test } = require('sounding')
const ensureSchema = require('../../../../api/helpers/auth/ensure-schema')

test('authentication columns upgrade legacy tables idempotently without losing users', async ({
  expect
}) => {
  const previousSails = global.sails
  const db = new Database(':memory:')
  try {
    db.exec(
      'CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE cli_tokens (id INTEGER PRIMARY KEY); INSERT INTO users(id) VALUES (1);'
    )
    global.sails = {
      getDatastore: () => ({
        sendNativeQuery: async (sql) => {
          const stmt = db.prepare(sql)
          return stmt.reader ? { rows: stmt.all() } : stmt.run()
        }
      })
    }
    await ensureSchema.fn()
    await ensureSchema.fn()
    expect(db.prepare('SELECT * FROM users').get()).toEqual({
      id: 1,
      auth_version: ''
    })
    expect(
      db
        .prepare('PRAGMA table_info(cli_tokens)')
        .all()
        .some((column) => column.name === 'auth_version')
    ).toBe(true)
  } finally {
    db.close()
    global.sails = previousSails
  }
})
