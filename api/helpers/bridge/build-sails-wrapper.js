module.exports = {
  friendlyName: 'Build Sails wrapper',

  description:
    'Prepare a Waterline expression for execution by the warm Bridge runtime.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code that uses sails.models / Waterline'
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ code }) {
    // The worker owns the Sails lifecycle. Keeping this helper as the single
    // preparation boundary avoids changing the Bridge feature helpers while
    // ensuring they no longer load and lower the target app for every query.
    return code
  }
}
