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
    executionId: {
      type: 'string',
      required: true,
      regex:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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

  fn: async function ({
    code,
    executionId,
    sourceStartLine,
    sourceStartColumn
  }) {
    if (!code.trim()) {
      throw { badRequest: 'Code cannot be empty.' }
    }

    const execution = sails.helpers.helm.beginExecution(
      executionId,
      this.req,
      this.res
    )

    try {
      return await sails.helpers.helm.evaluate(
        code,
        sourceStartLine,
        sourceStartColumn,
        execution.signal
      )
    } finally {
      execution.release()
    }
  }
}
