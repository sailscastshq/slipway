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
    },
    requiresConfirmedCancellation: { type: 'boolean', defaultsTo: false }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: function ({ executionId, req, res, requiresConfirmedCancellation }) {
    const execution = helmExecutions.register({
      executionId,
      requiresConfirmedCancellation,
      userId: req.auth?.userId || req.session.userId
    })
    const onResponseClose = () => {
      if (!res.writableEnded) {
        execution.abort(
          'Helm execution was cancelled after its request closed.'
        )
      }
    }
    res.once('close', onResponseClose)
    // Authorization and runtime lookup can finish after the client has left.
    // Registering a future listener must not miss that earlier disconnect.
    if (req.aborted || res.destroyed || res.closed) {
      execution.abort(
        'Helm execution was cancelled before admission completed.'
      )
    }

    return {
      signal: execution.signal,
      release(result) {
        res.off('close', onResponseClose)
        execution.release(result)
      }
    }
  }
}
