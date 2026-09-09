const { Sails } = require('sails')
const host = new Sails(),
  directory = process.argv[2],
  path = require('node:path')
host.load(
  {
    appPath: directory,
    globals: false,
    hooks: {
      orm: require('sails-hook-orm'),
      grunt: false,
      'wake-storage': require('../../api/hooks/wake-storage')
    },
    datastores: {
      default: { adapter: 'sails-sqlite', url: ':memory:' },
      analytics: {
        adapter: 'sails-sqlite',
        url: path.join(directory, 'analytics.db')
      }
    },
    models: { datastore: 'default', migrate: 'safe' },
    bootstrap: false,
    log: { level: 'error' }
  },
  async (error) => {
    if (error) {
      console.error(error)
      process.exitCode = 1
      return
    }
    try {
      await host.getDatastore().sendNativeQuery('SELECT 1')
      console.log(
        JSON.stringify({
          fallback: host.wakeStorageFallback,
          url: host.config.datastores.analytics.url
        })
      )
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      host.lower(() => {})
    }
  }
)
