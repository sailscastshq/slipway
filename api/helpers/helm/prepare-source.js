const helmRuntime = require('../../lib/helm-runtime')

module.exports = {
  friendlyName: 'Prepare Helm source',

  description:
    'Parse Helm JavaScript and return its complete final top-level expression.',

  inputs: {
    source: {
      type: 'string',
      required: true
    },
    maxSourceBytes: {
      type: 'number',
      min: 1
    },
    sourceStartLine: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      max: 1000000
    },
    sourceStartColumn: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      max: 1000000
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    source,
    maxSourceBytes,
    sourceStartLine,
    sourceStartColumn
  }) {
    return helmRuntime.prepareSource(source, {
      maxSourceBytes: maxSourceBytes || sails.config.custom.helm.maxSourceBytes,
      sourceStartLine,
      sourceStartColumn
    })
  }
}
