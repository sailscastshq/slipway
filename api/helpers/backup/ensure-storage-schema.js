module.exports = {
  friendlyName: 'Ensure backup object storage schema',
  fn: async function () {
    const datastore = sails.getDatastore()
    const result = await datastore.sendNativeQuery('PRAGMA table_info(backups)')
    const columns = new Set(
      (result.rows || result || []).map((column) => column.name)
    )
    for (const [name, definition] of [
      ['object_key', 'TEXT'],
      ['storage', "TEXT NOT NULL DEFAULT '{}'"],
      ['storage_credentials', 'TEXT']
    ]) {
      if (!columns.has(name))
        await datastore.sendNativeQuery(
          `ALTER TABLE backups ADD COLUMN ${name} ${definition}`
        )
    }
  }
}
