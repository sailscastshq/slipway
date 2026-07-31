module.exports = function buildFlagsEnabledHelper({ evaluate }) {
  if (typeof evaluate !== 'function') {
    throw new Error('A release flag evaluator is required.')
  }

  return {
    friendlyName: 'Check release flag',

    description:
      'Return whether a Slipway release flag is enabled for this request or context.',

    inputs: {
      key: {
        type: 'string',
        required: true,
        regex: /\S/
      },
      req: {
        type: 'ref'
      },
      context: {
        type: 'ref'
      },
      defaultValue: {
        type: 'boolean',
        defaultsTo: false
      }
    },

    exits: {
      success: {
        outputType: 'boolean'
      }
    },

    fn: async function (inputs) {
      return await evaluate(inputs)
    }
  }
}
