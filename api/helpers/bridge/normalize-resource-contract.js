const normalizeBridgeResourceContract = require('../../../packages/hook/lib/bridge/normalize-resource-contract')

module.exports = {
  friendlyName: 'Normalize Bridge resource contract',

  description:
    'Merge Waterline metadata with a target app Bridge resource configuration.',

  inputs: {
    models: {
      type: 'ref',
      required: true
    },
    config: {
      type: 'ref',
      defaultsTo: {}
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ models, config }) {
    return normalizeBridgeResourceContract({ models, config })
  }
}
