module.exports = {
  friendlyName: 'Ensure restore operation schema',
  inputs: {},
  fn: async function () {
    await sails.getDatastore()
      .sendNativeQuery(`CREATE TABLE IF NOT EXISTS restore_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, backup_id INTEGER NOT NULL, service_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL, requested_by INTEGER, status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'queued', snapshot_id INTEGER, error TEXT NOT NULL DEFAULT '',
      started_at INTEGER, completed_at INTEGER, created_at INTEGER, updated_at INTEGER
    )`)
    await sails
      .getDatastore()
      .sendNativeQuery(
        'CREATE INDEX IF NOT EXISTS restore_operations_service_status ON restore_operations(service_id, status)'
      )
  }
}
