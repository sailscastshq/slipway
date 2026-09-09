module.exports = {
  friendlyName: 'Ensure service version schema',

  description:
    'Add immutable service-image and upgrade-state columns on existing production SQLite databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore()
    const result = await datastore.sendNativeQuery(
      'PRAGMA table_info(services)'
    )
    const existing = new Set(
      (result.rows || result || []).map((row) => row.name)
    )

    await datastore.sendNativeQuery(
      `CREATE TABLE IF NOT EXISTS custom_service_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, actor INTEGER NOT NULL, environment INTEGER NOT NULL, definition TEXT, image_reference TEXT NOT NULL, image_metadata TEXT, expires_at INTEGER NOT NULL, service_id INTEGER, created_at INTEGER, updated_at INTEGER)`
    )
    await datastore.sendNativeQuery(
      `CREATE TABLE IF NOT EXISTS domain_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, created_at INTEGER, updated_at INTEGER)`
    )
    const columns = [
      ['public_route', "TEXT NOT NULL DEFAULT '{}'"],
      ['custom_definition', 'TEXT'],
      ['custom_state', "TEXT NOT NULL DEFAULT '{}'"],
      ['management_mode', "TEXT NOT NULL DEFAULT 'managed'"],
      ['external_connection', 'TEXT'],
      ['external_verification', "TEXT NOT NULL DEFAULT '{}'"],
      ['image_reference', 'TEXT'],
      ['image_metadata', 'TEXT'],
      ['upgrade_state', 'TEXT']
    ]

    for (const [name, type] of columns) {
      if (!existing.has(name)) {
        await datastore.sendNativeQuery(
          `ALTER TABLE services ADD COLUMN ${name} ${type}`
        )
      }
    }
    await Service.update({
      type: 'custom',
      status: { in: ['creating', 'changing'] }
    }).set({ status: 'failed' })
  }
}
