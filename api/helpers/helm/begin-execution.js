const helmExecutions = require('../../lib/helm-executions')

module.exports = {
  friendlyName: 'Begin Helm execution',

  description:
    'Register a user-scoped Helm execution and cancel it if its request disconnects.',

  sync: true,

  inputs: {
    executionId: {
      type: 'string',
      required: true
    },
    req: {
      type: 'ref',
      required: true
    },
    res: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: function ({ executionId, req, res }) {
    const execution = helmExecutions.register({
      executionId,
      userId: req.session.userId
    })
    const onResponseClose = () => {
      if (!res.writableEnded) {
        execution.abort(
          'Helm execution was cancelled after its request closed.'
        )
      }
    }
    res.once('close', onResponseClose)

    return {
      signal: execution.signal,
      release() {
        res.off('close', onResponseClose)
        execution.release()
      }
    }
  }
}
