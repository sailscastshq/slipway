module.exports = {
  friendlyName: 'Ensure source operation schema',
  inputs: {},
  fn: async function () {
    await sails.getDatastore()
      .sendNativeQuery(`CREATE TABLE IF NOT EXISTS source_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      requested_by INTEGER, status TEXT NOT NULL DEFAULT 'queued',
      archive_path TEXT NOT NULL, source_revision TEXT, error TEXT NOT NULL DEFAULT '',
      cancel_requested INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER
    )`)
    await sails
      .getDatastore()
      .sendNativeQuery(
        'CREATE INDEX IF NOT EXISTS source_operations_status ON source_operations(status, project_id)'
      )
  }
}
