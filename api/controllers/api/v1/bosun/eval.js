module.exports = {
  friendlyName: 'Bosun Helm eval',

  description:
    'Evaluate a JavaScript expression with access to Slipway models and helpers.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code to evaluate'
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
      statusCode: 200
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ code, sourceStartLine, sourceStartColumn }) {
    if (!code.trim()) {
      throw { badRequest: 'Code cannot be empty.' }
    }

    return sails.helpers.helm.evaluate(code, sourceStartLine, sourceStartColumn)
  }
}
