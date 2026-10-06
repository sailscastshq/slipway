const path = require('node:path')
const migrations = require('./release-migrations')

// Production schema belongs to the pre-lift Bosun release executor. Legacy
// helpers retain development/test initialization and their data backfills.
module.exports = function releaseSchemaReady(sails) {
  if (sails.config.environment === 'test') return false
  if (
    sails.config.environment !== 'production' &&
    process.env.NODE_ENV !== 'production'
  )
    return false
  for (const datastore of Object.keys(migrations.files)) {
    const configured = sails.config.datastores?.[datastore]
    if (
      configured?.adapter !== 'sails-sqlite' ||
      !configured.url ||
      !migrations.current({
        type: 'sqlite',
        datastore,
        path: path.resolve(configured.url)
      })
    )
      throw new Error(
        `Slipway ${datastore} release schema is not ready; start through node app.js before using production helpers.`
      )
  }
  return true
}
