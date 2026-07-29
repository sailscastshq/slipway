module.exports = {
  friendlyName: 'Execute Helm in container',

  description:
    'Evaluate JavaScript inside a running app container through the shared Helm runtime.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
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
    executionId: {
      type: 'string',
      required: true,
      regex:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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

  fn: async function ({
    containerName,
    source,
    sourceStartLine,
    sourceStartColumn,
    executionId,
    signal
  }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    let stopPromise
    const stopContainerExecution = () => {
      stopPromise ||= sails.helpers.helm.stopContainerExecution
        .with({
          containerName,
          executionId
        })
        .catch(() => false)
    }

    if (signal) {
      if (signal.aborted) stopContainerExecution()
      else
        signal.addEventListener('abort', stopContainerExecution, {
          once: true
        })
    }

    try {
      return await sails.helpers.helm.run.with({
        command: dockerPath,
        args: [
          'exec',
          '-i',
          '-e',
          `SLIPWAY_HELM_EXECUTION_ID=${executionId}`,
          containerName,
          'node'
        ],
        source,
        sourceStartLine,
        sourceStartColumn,
        bootstrapSails: true,
        executionId,
        signal
      })
    } finally {
      if (signal) {
        signal.removeEventListener('abort', stopContainerExecution)
      }
      if (stopPromise) await stopPromise
    }
  }
}
