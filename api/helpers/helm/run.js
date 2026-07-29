const { Readable } = require('node:stream')

const helmRuntime = require('../../lib/helm-runtime')

module.exports = {
  friendlyName: 'Run Helm',

  description:
    'Run a Helm snippet in an isolated, bounded process and return its result envelope.',

  inputs: {
    command: {
      type: 'string',
      required: true
    },
    args: {
      type: 'ref',
      defaultsTo: []
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
    bootstrapSails: {
      type: 'boolean',
      defaultsTo: true
    },
    timeoutMs: {
      type: 'number',
      min: 1
    },
    executionId: {
      type: 'string'
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
    command,
    args,
    source,
    sourceStartLine,
    sourceStartColumn,
    bootstrapSails,
    timeoutMs,
    executionId,
    signal
  }) {
    const limits = sails.config.custom.helm
    const startedAt = Date.now()
    let prepared

    try {
      prepared = await sails.helpers.helm.prepareSource.with({
        source,
        sourceStartLine,
        sourceStartColumn,
        maxSourceBytes: limits.maxSourceBytes
      })
    } catch (error) {
      return helmRuntime.createFailureResult(error, Date.now() - startedAt)
    }

    const executionTimeoutMs = timeoutMs || limits.timeoutMs
    const runnerSource = helmRuntime.buildRunnerSource({
      preparedSource: prepared.source,
      finalExpression: prepared.finalExpression,
      sourceStartLine,
      sourceStartColumn,
      bootstrapSails,
      timeoutMs: executionTimeoutMs,
      maxLogBytes: limits.maxLogBytes,
      maxResultBytes: limits.maxResultBytes,
      executionId
    })

    try {
      const processResult = await sails.helpers.streams.runProcess.with({
        command,
        args,
        input: Readable.from([runnerSource]),
        timeoutMs: executionTimeoutMs + limits.processGraceMs,
        maxInputBytes: Buffer.byteLength(runnerSource),
        maxOutputBytes: limits.maxProcessOutputBytes,
        maxStdoutBytes: limits.maxProcessOutputBytes,
        maxStderrBytes: limits.maxProcessStderrBytes,
        captureStdout: true,
        killGraceMs: limits.killGraceMs,
        signal
      })

      const result = helmRuntime.parseRunnerOutput(processResult.stdout)
      result.truncated ||=
        processResult.stdoutTruncated || processResult.stderrTruncated
      return helmRuntime.withResultMetadata(result)
    } catch (error) {
      const partialLogs = helmRuntime.parseRunnerLogs(error?.stdout)
      const failure = helmRuntime.createFailureResult(
        normalizeProcessError(error, executionTimeoutMs),
        Date.now() - startedAt,
        {
          logs: partialLogs,
          logsPartial: partialLogs.length > 0
        }
      )
      failure.truncated =
        error?.stdoutTruncated === true || error?.stderrTruncated === true
      return helmRuntime.withResultMetadata(failure)
    }
  }
}

function normalizeProcessError(error, timeoutMs) {
  if (error?.code === 'HELM_CANCELLED' || error?.code === 'PROCESS_ABORTED') {
    const cancelledError = new Error('Helm execution was cancelled.')
    cancelledError.name = 'CancelledError'
    cancelledError.code = 'HELM_CANCELLED'
    return cancelledError
  }

  if (error?.code !== 'PROCESS_TIMEOUT') return error

  const timeoutError = new Error(
    `Helm execution timed out after ${timeoutMs}ms.`
  )
  timeoutError.name = 'TimeoutError'
  timeoutError.code = 'HELM_TIMEOUT'
  return timeoutError
}
