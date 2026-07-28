module.exports = {
  friendlyName: 'Ensure Bridge schema',

  description:
    'Create app-scoped Bridge access tables and credentials on existing production databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore()

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bridge_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        status TEXT NOT NULL DEFAULT 'pending',
        host_user_id TEXT,
        host_user_name TEXT,
        activated_at INTEGER,
        last_used_at INTEGER,
        revoked_at INTEGER,
        invite_token_hash TEXT,
        invite_expires_at INTEGER,
        app INTEGER NOT NULL,
        environment INTEGER NOT NULL,
        project INTEGER NOT NULL,
        team INTEGER NOT NULL,
        invited_by INTEGER NOT NULL,
        revoked_by INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS bridge_access_app_email
      ON bridge_access (app, email)
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bridge_access_app_status
      ON bridge_access (app, status, created_at)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bridge_launch_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        access_id INTEGER NOT NULL,
        app INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bridge_launch_codes_expiry
      ON bridge_launch_codes (expires_at, used_at)
    `)

    const result = await datastore.sendNativeQuery('PRAGMA table_info(apps)')
    const existing = new Set(
      (result.rows || result || []).map((row) => row.name)
    )
    const columns = [
      ['bridge_enabled', 'BOOLEAN NOT NULL DEFAULT 0'],
      ['bridge_secret', 'TEXT']
    ]

    for (const [name, type] of columns) {
      if (!existing.has(name)) {
        await datastore.sendNativeQuery(
          `ALTER TABLE apps ADD COLUMN ${name} ${type}`
        )
      }
    }
  }
}
