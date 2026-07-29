module.exports = {
  friendlyName: 'Evaluate Helm',

  description:
    'Evaluate JavaScript against this Slipway instance through the shared Helm runtime.',

  inputs: {
    source: {
      type: 'string',
      required: true
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
    },
    signal: {
      type: 'ref',
      description: 'Optional AbortSignal for user cancellation.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ source, sourceStartLine, sourceStartColumn, signal }) {
    return sails.helpers.helm.run.with({
      command: process.execPath,
      source,
      sourceStartLine,
      sourceStartColumn,
      bootstrapSails: true,
      signal
    })
  }
}
