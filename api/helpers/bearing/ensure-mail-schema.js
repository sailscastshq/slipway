module.exports = {
  friendlyName: 'Ensure Bearing email schema',
  fn: async function () {
    if (require('../../lib/release-schema-ready')(sails)) return
    const registry = require('../../lib/releases/bearing-update-emails-v1.json')
    for (const definition of Object.values(registry.datastores.default)) {
      await sails
        .getDatastore()
        .sendNativeQuery(
          definition.create.replace(
            'CREATE TABLE',
            'CREATE TABLE IF NOT EXISTS'
          )
        )
      for (const index of definition.indexes)
        await sails
          .getDatastore()
          .sendNativeQuery(
            index.replace(
              /CREATE (UNIQUE )?INDEX/,
              (_, unique) => `CREATE ${unique || ''}INDEX IF NOT EXISTS`
            )
          )
    }
  }
}
