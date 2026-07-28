module.exports = {
  friendlyName: 'Evaluate Helm',

  description:
    'Evaluate JavaScript against this Slipway instance through the shared Helm runtime.',

  inputs: {
    source: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ source }) {
    return sails.helpers.helm.run.with({
      command: process.execPath,
      source,
      bootstrapSails: true
    })
  }
}
