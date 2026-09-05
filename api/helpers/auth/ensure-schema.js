module.exports = {
  friendlyName: 'Ensure authentication schema',
  inputs: {},
  fn: async function () {
    const datastore = sails.getDatastore()
    for (const table of ['users', 'cli_tokens']) {
      const result = await datastore.sendNativeQuery(
        `PRAGMA table_info(${table})`
      )
      const columns = result.rows || result || []
      if (!columns.some((column) => column.name === 'auth_version')) {
        await datastore.sendNativeQuery(
          `ALTER TABLE ${table} ADD COLUMN auth_version TEXT NOT NULL DEFAULT ''`
        )
      }
    }
  }
}
