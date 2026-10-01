module.exports = {
  friendlyName: 'Ensure restore test schema',
  fn: async function () {
    await sails.getDatastore()
      .sendNativeQuery(`CREATE TABLE IF NOT EXISTS restore_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, backup INTEGER NOT NULL, service INTEGER NOT NULL,
      team INTEGER NOT NULL, requested_by INTEGER, status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'queued', resource_name TEXT NOT NULL UNIQUE,
      report TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', cleanup_pending INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER, completed_at INTEGER, created_at INTEGER, updated_at INTEGER
    )`)
    await sails
      .getDatastore()
      .sendNativeQuery(
        'CREATE INDEX IF NOT EXISTS restore_tests_backup ON restore_tests(backup, id)'
      )
  }
}
