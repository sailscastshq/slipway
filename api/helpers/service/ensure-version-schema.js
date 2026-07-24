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

    const columns = [
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
  }
}
