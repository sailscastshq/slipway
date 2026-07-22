const { pipeline } = require('node:stream/promises')

const createByteLimitTransform = require('../../lib/byte-limit-transform')

module.exports = {
  friendlyName: 'Copy stream',

  description:
    'Copy one stream to another with backpressure and an explicit byte limit.',

  inputs: {
    input: {
      type: 'ref',
      required: true,
      description: 'Readable stream.'
    },
    output: {
      type: 'ref',
      required: true,
      description: 'Writable stream.'
    },
    maxBytes: {
      type: 'number',
      required: true,
      min: 1
    },
    label: {
      type: 'string',
      defaultsTo: 'Stream'
    },
    signal: {
      type: 'ref',
      description: 'Optional AbortSignal.'
    },
    timeoutMs: {
      type: 'number',
      min: 1,
      description: 'Optional transfer deadline.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ input, output, maxBytes, label, signal, timeoutMs }) {
    const limiter = createByteLimitTransform({ maxBytes, label })
    const controller = new AbortController()
    let timedOut = false
    const onAbort = () => controller.abort()
    const timeout = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      : null

    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      await pipeline(input, limiter, output, { signal: controller.signal })
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error(
          `${label} timed out after ${timeoutMs}ms.`
        )
        timeoutError.code = 'STREAM_TIMEOUT'
        throw timeoutError
      }
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    return { bytes: limiter.getBytes() }
  }
}
