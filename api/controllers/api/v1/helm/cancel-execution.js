module.exports = {
  friendlyName: 'Cancel Helm execution',

  description: 'Stop an active Helm execution owned by the current user.',

  inputs: {
    executionId: {
      type: 'string',
      required: true,
      regex:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    }
  },

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function ({ executionId }) {
    return {
      cancelled: await sails.helpers.helm.cancelExecution(
        executionId,
        this.req.session.userId
      )
    }
  }
}
