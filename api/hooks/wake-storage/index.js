const fs = require('node:fs')
const path = require('node:path')
module.exports = function wakeStorage(sails) {
  return {
    configure() {
      const config = sails.config.datastores?.analytics
      if (
        !config ||
        config.adapter !== 'sails-sqlite' ||
        config.url === ':memory:'
      )
        return
      let connection
      try {
        const filename = path.resolve(config.url)
        fs.mkdirSync(path.dirname(filename), { recursive: true })
        const Database = require('better-sqlite3')
        connection = new Database(filename, { timeout: 100 })
        connection.prepare('SELECT name FROM sqlite_master LIMIT 1').all()
        // Verify writes without retaining user data or changing existing tables.
        connection.exec(
          'BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS wake_storage_probe (id INTEGER); ROLLBACK;'
        )
      } catch {
        // ORM must still initialize so normal auth/deployments remain available. This
        // fallback is deliberately never marked ready and cannot accept analytics.
        sails.wakeStorageFallback = true
        config.url = ':memory:'
        sails.log.warn(
          'Wake storage could not open. Analytics is disabled; repair its database or volume and restart Slipway.'
        )
      } finally {
        connection?.close()
      }
    }
  }
}
