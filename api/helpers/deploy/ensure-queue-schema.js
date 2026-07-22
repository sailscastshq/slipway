module.exports = {
  friendlyName: 'Ensure deployment queue schema',

  description:
    'Create the durable deployment coordinator tables on existing production SQLite databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore()

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS deployment_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deployment_id INTEGER NOT NULL UNIQUE,
        target_key TEXT NOT NULL,
        app_slug TEXT NOT NULL DEFAULT 'app',
        kind TEXT NOT NULL DEFAULT 'deploy',
        target_deployment_id INTEGER,
        stage TEXT NOT NULL DEFAULT 'queued',
        attempt INTEGER NOT NULL DEFAULT 0,
        candidate_container_name TEXT,
        previous_container_name TEXT,
        image_name TEXT,
        host_port INTEGER,
        build_context_path TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS deployment_jobs_target_stage
      ON deployment_jobs (target_key, stage, created_at, id)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS deployment_leases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_key TEXT NOT NULL UNIQUE,
        deployment_id INTEGER NOT NULL UNIQUE,
        token TEXT NOT NULL UNIQUE,
        owner TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'claimed',
        heartbeat_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS deployment_leases_expiry
      ON deployment_leases (expires_at)
    `)
  }
}
