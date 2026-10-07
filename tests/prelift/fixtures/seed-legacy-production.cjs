const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const encrypted = require('encrypted-attr')
const ddl = require('./legacy-production-ddl.json')

const files = {
  default: 'app.db',
  observability: 'observability.db',
  analytics: 'analytics.db',
  cache: 'stash.db'
}

module.exports = function seed(directory, layouts = ddl) {
  fs.mkdirSync(directory, { recursive: true })
  for (const [datastore, statements] of Object.entries(layouts.datastores)) {
    const db = new Database(path.join(directory, files[datastore]))
    try {
      for (const sql of statements) db.exec(sql)
    } finally {
      db.close()
    }
  }
  const db = new Database(path.join(directory, 'app.db'))
  try {
    db.exec(`
      INSERT INTO users (id,email,is_genesis_user,auth_version)
        VALUES (1,'legacy@example.test','true','legacy-session-preserved');
      INSERT INTO settings (key,value) VALUES ('installationCompleted','true');
      INSERT INTO environments (id,name,slug,is_preview,pr_number,env_vars,env_var_metadata)
        VALUES (1,'Legacy','legacy','false',17,'{}','{}');
      CREATE TABLE custom_notes (value TEXT);
      INSERT INTO custom_notes VALUES ('preserved');
    `)
    const key =
      process.env.DATA_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64')
    const encrypt = (value) =>
      encrypted(undefined, {
        keys: { default: key },
        keyId: 'default'
      }).encryptAttribute(undefined, JSON.stringify(value))
    db.prepare(
      `INSERT INTO apps
      (id,name,slug,status,environment,is_default,app_env_vars,bridge_secret,secure_env_vars)
      VALUES (1,'Legacy','legacy','stopped',1,'true','{}',?,?)`
    ).run(encrypt('sanitized-fixture-secret'), encrypt({ fixture: 'retained' }))
  } finally {
    db.close()
  }
  const metrics = new Database(path.join(directory, 'observability.db'))
  try {
    metrics
      .prepare(
        `INSERT INTO container_metrics
      (container_name, recorded_at, legacy_source_id) VALUES (?, ?, ?)`
      )
      .run('legacy-fixture', Date.now(), 123)
  } finally {
    metrics.close()
  }
}
