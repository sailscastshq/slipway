module.exports = {
  friendlyName: 'Ensure webhook delivery schema',
  inputs: {},
  fn: async function () {
    await sails.getDatastore()
      .sendNativeQuery(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'processing', result TEXT,
      created_at INTEGER, updated_at INTEGER
    )`)
    await sails
      .getDatastore()
      .sendNativeQuery(
        'CREATE INDEX IF NOT EXISTS webhook_deliveries_retention ON webhook_deliveries (created_at)'
      )
  }
}
