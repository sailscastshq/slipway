module.exports = {
  friendlyName: 'Ensure release flag schema',

  description:
    'Create the environment-scoped release flag table on existing production databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore()

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        key TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        rollout_percentage INTEGER NOT NULL DEFAULT 0,
        targets TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        changed_by_name TEXT,
        changed_by INTEGER,
        environment INTEGER NOT NULL,
        app INTEGER NOT NULL
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_app_key
      ON feature_flags (environment, app, key)
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS feature_flags_environment_updated
      ON feature_flags (environment, updated_at DESC)
    `)
  }
}
