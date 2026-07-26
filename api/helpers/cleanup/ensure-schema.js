module.exports = {
  friendlyName: 'Ensure cleanup schema',

  description:
    'Create the durable cleanup table on existing production SQLite databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore()

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS cleanup_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_key TEXT NOT NULL UNIQUE,
        request_key TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        project_id INTEGER,
        environment_id INTEGER,
        app_id INTEGER,
        service_id INTEGER,
        retention_policy TEXT NOT NULL DEFAULT 'retain',
        status TEXT NOT NULL DEFAULT 'pending',
        stage TEXT NOT NULL DEFAULT 'pending',
        snapshot TEXT NOT NULL DEFAULT '{}',
        stages TEXT NOT NULL DEFAULT '{}',
        warnings TEXT NOT NULL DEFAULT '[]',
        error_message TEXT,
        completed_at INTEGER,
        requested_by INTEGER,
        team INTEGER NOT NULL,
        ip_address TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    const result = await datastore.sendNativeQuery(
      'PRAGMA table_info(cleanup_operations)'
    )
    const existing = new Set(
      (result.rows || result || []).map((row) => row.name)
    )
    if (!existing.has('request_key')) {
      await datastore.sendNativeQuery(
        'ALTER TABLE cleanup_operations ADD COLUMN request_key TEXT'
      )
      await datastore.sendNativeQuery(`
        UPDATE cleanup_operations
        SET request_key = target_key
        WHERE request_key IS NULL
      `)
    }

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS cleanup_operations_status
      ON cleanup_operations (status, updated_at, id)
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS cleanup_operations_scope
      ON cleanup_operations (project_id, environment_id, app_id, service_id)
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS cleanup_operations_request
      ON cleanup_operations (request_key, created_at, id)
    `)
  }
}
