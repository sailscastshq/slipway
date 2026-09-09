module.exports = {
  friendlyName: 'Ensure Wake app schema',
  inputs: {},
  fn: async function () {
    const db = sails.getDatastore()
    const result = await db.sendNativeQuery('PRAGMA table_info(apps)')
    const names = new Set((result.rows || result).map((column) => column.name))
    for (const [name, definition] of [
      ['wake_enabled', 'BOOLEAN NOT NULL DEFAULT 0'],
      ['wake_secret', 'TEXT'],
      ['wake_settings', "TEXT NOT NULL DEFAULT '{}'"]
    ]) {
      if (!names.has(name)) {
        await db.sendNativeQuery(
          `ALTER TABLE apps ADD COLUMN ${name} ${definition}`
        )
      }
    }
  }
}
