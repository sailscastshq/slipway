const canonicalModelSnapshot = require('../../lib/canonical-model-snapshot')

module.exports = {
  friendlyName: 'Get Bosun models',

  description:
    'Collect Slipway runtime Waterline models for a selected datastore.',

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
    const { datastore } = await sails.helpers.bosun.getDatabaseService(database)
    const models = canonicalModelSnapshot(sails.models, datastore)

    return {
      datastore,
      authoritative: true,
      formatVersion: 1,
      models,
      modelCount: Object.keys(models).length
    }
  }
}
