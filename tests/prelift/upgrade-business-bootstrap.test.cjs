const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const business = require('../../api/lib/upgrade-business-bootstrap')

test('retained business startup repairs legacy data without DDL or resurrecting removed membership', async () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE users(id INTEGER, team INTEGER, team_role TEXT);
    CREATE TABLE teams(id INTEGER, owner INTEGER);
    CREATE TABLE team_memberships(key TEXT UNIQUE, user_id INTEGER, team_id INTEGER, role TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE cli_tokens(user INTEGER, team_id INTEGER);
    CREATE TABLE settings(key TEXT UNIQUE, value TEXT);
    CREATE TABLE cleanup_operations(target_key TEXT, request_key TEXT);
    CREATE TABLE bearing_feedback(status TEXT);
    CREATE TABLE bearing_updates(public_id TEXT, slug TEXT);
    CREATE TABLE telemetry_spans(created_at INTEGER);
    CREATE TABLE telemetry_exceptions(created_at INTEGER);
    CREATE TABLE telemetry_metrics(created_at INTEGER);
    INSERT INTO users VALUES(1,2,'member');
    INSERT INTO teams VALUES(2,1);
    INSERT INTO cli_tokens VALUES(1,NULL);
    INSERT INTO cleanup_operations VALUES('legacy',NULL),('explicit','kept');
    INSERT INTO bearing_feedback VALUES('open'),('completed');
    INSERT INTO bearing_updates VALUES('PUBLIC_ID',''),('KEEP','kept');
    INSERT INTO telemetry_spans VALUES(NULL),(9999999999999),(1);
    INSERT INTO telemetry_exceptions VALUES(NULL);
    INSERT INTO telemetry_metrics VALUES(NULL);
  `)
  const before = db.prepare('SELECT sql FROM sqlite_schema ORDER BY name').all()
  const queries = [],
    updates = [],
    serviceUpdates = [],
    pragmas = []
  const previous = Object.fromEntries(
    ['sails', 'Setting', 'App', 'Service'].map((name) => [name, global[name]])
  )
  const datastore = {
    manager: { pragma: (value) => pragmas.push(value) },
    async sendNativeQuery(sql, params = []) {
      queries.push(sql)
      assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/i)
      const statement = db.prepare(sql)
      return {
        rows: statement.reader
          ? statement.all(...params)
          : (statement.run(...params), [])
      }
    },
    async transaction(work) {
      db.exec('BEGIN')
      try {
        const result = await work({})
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  }
  try {
    global.sails = {
      getDatastore: () => datastore,
      log: { warn() {} },
      wakeStorageFallback: false
    }
    global.Setting = {
      findOne: async ({ key }) =>
        db.prepare('SELECT * FROM settings WHERE key=?').get(key),
      create: ({ key, value }) => ({
        usingConnection: async () =>
          db.prepare('INSERT INTO settings VALUES(?,?)').run(key, value)
      })
    }
    global.App = {
      find: () => ({
        decrypt: async () => [
          { id: 1, secureEnvVars: null, envVars: { TOKEN: 'synthetic-only' } },
          {
            id: 2,
            secureEnvVars: { TOKEN: 'kept' },
            envVars: { TOKEN: 'old' }
          },
          { id: 3, secureEnvVars: null, envVars: {} }
        ]
      }),
      updateOne: ({ id }) => ({
        set: async (values) => updates.push({ id, ...values })
      })
    }
    global.Service = {
      update: (criteria) => ({
        set: async (values) => serviceUpdates.push({ criteria, values })
      })
    }
    await business.bootstrap()
    await business.lookout()
    assert.deepEqual(db.prepare('SELECT team_id FROM cli_tokens').get(), {
      team_id: 2
    })
    assert.deepEqual(
      db.prepare('SELECT role,status FROM team_memberships').get(),
      { role: 'owner', status: 'active' }
    )
    db.prepare("UPDATE team_memberships SET status='removed'").run()
    await business.team()
    assert.equal(
      db.prepare('SELECT status FROM team_memberships').get().status,
      'removed'
    )
    assert.deepEqual(
      db
        .prepare(
          'SELECT request_key FROM cleanup_operations ORDER BY target_key'
        )
        .all(),
      [{ request_key: 'kept' }, { request_key: 'legacy' }]
    )
    assert.deepEqual(db.prepare('SELECT status FROM bearing_feedback').all(), [
      { status: 'reviewing' },
      { status: 'completed' }
    ])
    assert.deepEqual(db.prepare('SELECT slug FROM bearing_updates').all(), [
      { slug: 'public-id' },
      { slug: 'kept' }
    ])
    const timestamps = db
      .prepare('SELECT created_at FROM telemetry_spans')
      .all()
      .map((row) => row.created_at)
    assert.ok(timestamps[0] > 0 && timestamps[0] < 9999999999999)
    assert.ok(timestamps[1] > 0 && timestamps[1] < 9999999999999)
    assert.equal(timestamps[2], 1)
    assert.deepEqual(updates, [
      { id: 1, secureEnvVars: { TOKEN: 'synthetic-only' }, envVars: {} }
    ])
    assert.deepEqual(serviceUpdates, [
      {
        criteria: { type: 'custom', status: { in: ['creating', 'changing'] } },
        values: { status: 'failed' }
      }
    ])
    assert.equal(sails.wakeStorageReady, true)
    assert.deepEqual(pragmas, [
      'synchronous=FULL',
      'busy_timeout=100',
      'cache_size=-65536'
    ])
    sails.wakeStorageFallback = true
    await assert.rejects(business.wake(), /unavailable/)
    assert.equal(sails.wakeStorageReady, false)
    assert.ok(queries.length > 0)
    assert.deepEqual(
      db.prepare('SELECT sql FROM sqlite_schema ORDER BY name').all(),
      before
    )
  } finally {
    db.close()
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete global[name]
      else global[name] = value
    }
  }
})
