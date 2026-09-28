const crypto = require('node:crypto')

const {
  buildSailsCompletionSource,
  collectSailsCompletionMetadata,
  emptyHelmCompletions,
  isHelmCompletionMetadata
} = require('../../lib/helm-completions')

module.exports = {
  friendlyName: 'Get Helm completions',

  description:
    'Return secret-free Sails model, helper, and configuration metadata for Helm completion.',

  inputs: {
    containerName: {
      type: 'string',
      description:
        'Optional running app container. When omitted, inspect this Sails app.'
    },
    expectedRuntime: { type: 'ref' }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, expectedRuntime }) {
    if (!containerName) {
      return {
        available: true,
        ...collectSailsCompletionMetadata(sails)
      }
    }

    const execute = (metadataOnly) =>
      sails.helpers.helm.executeInContainer.with({
        containerName,
        expectedRuntime,
        metadataOnly,
        source: metadataOnly ? 'undefined' : buildSailsCompletionSource(),
        sourceStartLine: 1,
        sourceStartColumn: 1,
        executionId: crypto.randomUUID()
      })

    if (expectedRuntime) {
      const fast = await execute(true)
      if (fast?.success && isHelmCompletionMetadata(fast.value)) {
        return { available: true, ...fast.value }
      }
      if (fast?.error?.code === 'HELM_APP_CONTEXT_UNAVAILABLE') {
        return { available: false, ...emptyHelmCompletions() }
      }
    }

    const result = await execute(false)

    if (!result?.success || !isHelmCompletionMetadata(result.value)) {
      return {
        available: false,
        ...emptyHelmCompletions()
      }
    }

    return {
      available: true,
      ...result.value
    }
  }
}
