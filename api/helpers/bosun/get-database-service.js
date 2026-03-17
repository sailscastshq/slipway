const path = require('path')

module.exports = {
  friendlyName: 'Get Bosun database service',

  description:
    'Resolve Bosun database metadata for internal SQLite datastores.',

  inputs: {
    database: {
      type: 'string',
      defaultsTo: 'app',
      isIn: ['app', 'observability', 'cache']
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ database }) {
    const databases = {
      app: {
        name: 'app',
        datastore: 'default',
        type: 'sqlite',
        path: path.resolve(sails.config.appPath, 'db/app.db')
      },
      observability: {
        name: 'observability',
        datastore: 'observability',
        type: 'sqlite',
        path: path.resolve(sails.config.appPath, 'db/observability.db')
      },
      cache: {
        name: 'cache',
        datastore: 'cache',
        type: 'sqlite',
        path: path.resolve(sails.config.appPath, 'db/stash.db')
      }
    }

    return databases[database]
  }
}
