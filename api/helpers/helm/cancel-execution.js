const helmExecutions = require('../../lib/helm-executions')

module.exports = {
  friendlyName: 'Cancel Helm execution',

  description:
    'Cancel an active Helm execution when it belongs to the requesting user.',

  inputs: {
    executionId: {
      type: 'string',
      required: true
    },
    userId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'boolean'
    }
  },

  fn: async function ({ executionId, userId }) {
    return await helmExecutions.cancel({
      executionId,
      userId,
      message: 'Helm execution was cancelled by the user.'
    })
  }
}
